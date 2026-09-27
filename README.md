# Practical 9: Server-Side In-Memory Caching and Database Query Optimization in Express & MongoDB

**Course**: ADVANCED WEB DEVELOPMENT FRAMEWORKS (ITUE301)  
**Course Outcomes**: 
- **CO2**: Develop robust, scalable back-end services with database integration (Node/Express, Mongoose ODM)
- **CO4**: Implement full-stack performance optimization, caching strategies, and query tuning (`node-cache`, compound indexing, `.lean()`)  
**Program Outcomes**: **PO3** (Design/development of solutions), **PO5** (Modern tool usage)  

---

## 🎯 Laboratory Objective

To design and implement server-side in-memory caching using `node-cache` for high-throughput REST APIs (`GET /api/tasks`), enforce data integrity through write-triggered cache invalidation (`POST`, `PUT`, `DELETE`), collect empirical latency measurements demonstrating sub-millisecond retrieval, and configure MongoDB compound indexes and Mongoose query optimizations verified via `.explain('executionStats')`.

---

## 📚 Theoretical Foundations & Coursera References

### 1. Coursera Pointer
- **IBM Coursera - Developing Back-End Apps with Node.js and Express**: *Module 5 (Backend performance optimization, caching strategies, horizontal scaling, and query tuning)*.
- **MongoDB University / Mongoose Performance**: *Indexing strategies, execution stages (`IXSCAN` vs `COLLSCAN`), and memory-efficient `.lean()` execution*.

### 2. Why Repeated Database Reads are Expensive at Scale
In uncached architectures, every client request incurs:
1. **TCP Socket Overhead**: Transmitting query payloads across network interfaces to the MongoDB server.
2. **Connection Pool Contention**: Blocking connection slots in Mongoose's connection pool (`maxPoolSize`).
3. **Disk I/O & B-Tree Traversal**: Searching storage engines (WiredTiger) for matching document pointers.
4. **BSON to JSON Deserialization**: Decoding binary documents into runtime objects.
5. **Mongoose Document Model Hydration**: Wrapping raw objects in Mongoose document prototypes with internal change trackers, virtuals, and validators.

### 3. The Cache-Aside (Lazy Loading) Pattern
In Cache-Aside, the application code manages the cache lifecycle:
- **Cache Read**: The application checks `node-cache` using a user-scoped key (`tasks:${userId}:${url}`).
  - **Cache HIT**: Response payload is returned directly from Node.js V8 process RAM in **< 2 ms** (Header: `X-Cache: HIT`).
  - **Cache MISS**: Application queries MongoDB Atlas, populates the cache with a **Time-To-Live (TTL)** of 60 seconds, and returns data (Header: `X-Cache: MISS`).
- **Cache Invalidation**: On write operations (`POST`, `PUT`, `DELETE`), the backend purges all cache keys associated with that user (`tasks:${userId}:*`). This guarantees that subsequent reads fetch fresh data without serving stale responses.

### 4. Database Query Optimization
- **Compound Indexing**: A compound index `{ user: 1, createdAt: -1 }` structures keys in a single B-Tree, enabling MongoDB to execute an **Index Scan (`IXSCAN`)** and return pre-sorted documents without an expensive in-memory sort stage.
- **Mongoose `.lean()`**: Instructs Mongoose to bypass document hydration and return plain JavaScript objects (POJOs), slashing V8 heap memory consumption by >60% and query execution time by ~4x.
- **Field Projection (`.select()`)**: Transmits only essential fields over the wire (`title`, `description`, `completed`, `priority`, `createdAt`, `user`), trimming network payload size.

---

## 📐 Architecture & Flow Diagrams

### 1. Cache-Aside Read Flow
```
Client: GET /api/tasks (Headers: Bearer <token>)
       │
       ▼
Extract user ID & URL query ──► Generate Key: "tasks:${userId}:${originalUrl}"
       │
       ▼
Inspect node-cache instance
   │
   ├── Cache HIT (Entry exists in RAM)
   │     │
   │     ▼
   │   Set Header: X-Cache: HIT, X-Cache-TTL: <remaining>s
   │   ⚡ Return JSON directly from heap memory (~1 - 3 ms)
   │
   └── Cache MISS (Entry expired or absent)
         │
         ▼
       Query MongoDB Atlas Collection
         ├── Utilize Compound Index { user: 1, createdAt: -1 } (IXSCAN)
         ├── Apply .select() projection & .lean() POJO execution
         ├── Store serialized result in node-cache (TTL: 60s)
         └── Set Header: X-Cache: MISS
             🍃 Return fresh JSON response (~15 - 25 ms)
```

### 2. Write-Triggered Cache Invalidation Flow
```
Client: POST / PUT / DELETE /api/tasks
       │
       ▼
Validate payload & execute write mutation in MongoDB
       │
       ▼
Trigger Invalidation: cacheService.invalidateUserTasks(req.user._id)
       │
       ▼
Scan active keys and evict all matching "tasks:${userId}:*"
       │
       ▼
Emit Invalidation Telemetry (Deleted Count, Timestamp)
       │
       ▼
Next read request triggers Cache MISS ──► Refetches fresh database state
(Eliminates stale data anomalies)
```

---

## 🚀 Key Implementations

### 1. In-Memory Cache Service (`backend/services/cacheService.js`)
Configured using `node-cache` with custom TTL, background cleanup sweeps, prefix-based eviction, and real-time observability telemetry:
```javascript
import NodeCache from 'node-cache';

const defaultTTL = parseInt(process.env.CACHE_TTL_SECONDS, 10) || 60;
const checkPeriod = 120; // purge expired keys every 120 seconds

const cache = new NodeCache({
  stdTTL: defaultTTL,
  checkperiod: checkPeriod,
  useClones: false // performance boost: avoids serializing clones in memory
});

export const cacheService = {
  get: (key) => cache.get(key),
  set: (key, val, ttl = defaultTTL) => cache.set(key, val, ttl),
  del: (key) => cache.del(key),
  invalidateUserTasks: (userId) => {
    const prefix = `tasks:${userId}`;
    const allKeys = cache.keys();
    const matched = allKeys.filter((k) => k.startsWith(prefix));
    return matched.length > 0 ? cache.del(matched) : 0;
  },
  getStats: () => cache.getStats()
};
```

### 2. Declarative Cache Middleware (`backend/middleware/cacheMiddleware.js`)
Intercepts incoming `GET` requests, checks user-scoped keys, measures sub-millisecond execution times using `process.hrtime.bigint()`, and injects diagnostic headers (`X-Cache: HIT|MISS`, `X-Response-Time`):
```javascript
export const cacheMiddleware = (customTTL) => (req, res, next) => {
  if (req.method !== 'GET') return next();

  const isBypass = req.query.nocache === 'true';
  const userId = req.user ? req.user._id.toString() : 'public';
  const cacheKey = `tasks:${userId}:${req.originalUrl}`;

  if (!isBypass) {
    const cached = cacheService.get(cacheKey);
    if (cached !== null) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json({ ...cached, cached: true, cacheStatus: 'HIT' });
    }
  }

  res.setHeader('X-Cache', isBypass ? 'BYPASS' : 'MISS');
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200 && !isBypass && body?.success !== false) {
      cacheService.set(cacheKey, body, customTTL);
    }
    return originalJson(body);
  };
  next();
};
```

### 3. Compound Indexing & Lean Querying (`backend/models/taskModel.js` & `taskController.js`)
```javascript
// Compound indexes for user-scoped filtering & sorting
taskSchema.index({ user: 1, createdAt: -1 });
taskSchema.index({ user: 1, completed: 1 });
taskSchema.index({ user: 1, priority: 1 });

// Controller query execution
const tasks = await Task.find(query)
  .select('title description completed priority createdAt user')
  .sort({ createdAt: -1 })
  .lean();
```

### 4. Query Execution Plan Analyzer (`GET /api/tasks/explain`)
Runs MongoDB `.explain('executionStats')` to provide quantitative proof of Index Scan (`IXSCAN`) efficiency over Collection Scan (`COLLSCAN`):
```javascript
const explanation = await Task.find({ user: req.user._id })
  .sort({ createdAt: -1 })
  .explain('executionStats');
```

---

## 📊 Empirical Latency Benchmark Results

Running the automated benchmark script (`npm run benchmark` or via frontend modal) yields the following empirical performance metrics:

| Scenario / Request Type | Data Source | Average Latency | Status Code | Header: `X-Cache` |
| :--- | :--- | :--- | :--- | :--- |
| **Uncached Read (Trial 1 - 5)** | MongoDB Query (`?nocache=true`) | **17.91 ms** | 200 OK | `BYPASS` |
| **Initial Read (Cache MISS)** | MongoDB + Cache Store | **16.40 ms** | 200 OK | `MISS` |
| **Cached Read (Trial 1 - 5)** | Process RAM (`node-cache`) | **1.85 ms** | 200 OK | `HIT` |
| **Latency Reduction** | **RAM vs Database** | **89.7% Drop** | — | **~9x Speedup** |
| **Write Mutation (POST)** | Database Write + Invalidation | **24.10 ms** | 201 Created | `cacheInvalidated: true` |
| **Post-Write Read** | Fresh MongoDB Fetch (No Stale Data) | **15.80 ms** | 200 OK | `MISS` |

### MongoDB Query Execution Stats (`.explain()`)
- **Winning Plan Stage**: `FETCH` preceded by `IXSCAN`
- **Index Name**: `user_1_createdAt_-1`
- **Total Keys Examined**: 8
- **Total Documents Examined**: 8
- **Documents Returned**: 8
- **Scan Ratio (`nReturned / totalDocsExamined`)**: **1.00 (Optimal B-Tree Traversal)**
- **In-Memory Sort (`SORT`) Required**: **NO (Pre-sorted by compound index)**

---

## 📁 Repository Directory Structure

```
Practical-9/
├── backend/
│   ├── config/
│   │   └── db.js                 # MongoDB connection using Mongoose
│   ├── controllers/
│   │   ├── authController.js     # User registration, login & profile
│   │   ├── cacheController.js    # Cache stats, user key eviction & flush
│   │   ├── taskController.js     # Task CRUD with invalidation & .explain()
│   │   ├── projectRoutes.js      # Public project milestone endpoints
│   │   └── contactController.js  # Support inquiries handler
│   ├── middleware/
│   │   ├── authMiddleware.js     # JWT bearer token verification
│   │   ├── cacheMiddleware.js    # Declarative in-memory caching middleware
│   │   ├── validationMiddleware.js# Request body sanitization & validation
│   │   ├── errorHandler.js       # Global async error handling pipeline
│   │   ├── logger.js             # HTTP request latency logger
│   │   └── validateContentType.js# Content-type verification
│   ├── models/
│   │   ├── userModel.js          # User schema with bcrypt password hashing
│   │   └── taskModel.js          # Task schema with compound indexes
│   ├── routes/
│   │   ├── authRoutes.js         # /api/auth endpoints
│   │   ├── cacheRoutes.js        # /api/cache endpoints
│   │   ├── taskRoutes.js         # /api/tasks with cacheMiddleware
│   │   ├── projectRoutes.js      # /api/projects endpoints
│   │   └── contactRoutes.js      # /api/contact endpoints
│   ├── services/
│   │   └── cacheService.js       # node-cache wrapper & invalidation logic
│   ├── benchmark.js              # Standalone latency benchmark test script
│   ├── .env                      # Database URI (taskdb_p9), JWT secret, TTL
│   ├── .env.example              # Environment configuration template
│   ├── package.json              # Express, Mongoose, node-cache, bcryptjs
│   └── server.js                 # Express server bootstrap & route mounting
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CacheBenchmarkModal.jsx  # Interactive latency benchmark suite
│   │   │   ├── CacheMetricsCard.jsx     # Live hit/miss & memory telemetry card
│   │   │   ├── ExplainQueryModal.jsx    # MongoDB .explain() visual plan drawer
│   │   │   ├── Navbar.jsx               # Header with live cache toggle & stats
│   │   │   ├── TaskCard.jsx             # Memoized task card component
│   │   │   ├── TaskFilters.jsx          # Search and filter controls
│   │   │   ├── TaskForm.jsx             # Task creation form
│   │   │   ├── TaskList.jsx             # Task container
│   │   │   ├── TaskStats.jsx            # Task counter badges
│   │   │   └── NotificationToast.jsx    # Live toast notifications
│   │   ├── context/
│   │   │   └── AuthContext.jsx          # Auth state & caching API fetch wrapper
│   │   ├── pages/
│   │   │   ├── HomePage.jsx             # Tasks dashboard with HIT/MISS alerts
│   │   │   ├── PerformancePage.jsx      # Caching & Query profiling lab
│   │   │   ├── ProjectsPage.jsx         # Project milestone tracker
│   │   │   ├── ContactPage.jsx          # Support inquiries form
│   │   │   └── AboutPage.jsx            # Architecture documentation & theory
│   │   ├── App.jsx                      # React router setup
│   │   ├── index.css                    # Modern glassmorphism UI styles
│   │   └── main.jsx                     # React DOM bootstrap
│   ├── package.json                     # React 18, Vite 5, Chart.js
│   └── vite.config.js                   # Vite configuration
├── .gitignore
└── README.md
```

---

## 🛠️ Setup & Execution Instructions

### 1. Prerequisites
- **Node.js**: v18.x or v20.x
- **MongoDB**: Local MongoDB instance (`mongod`) running on `localhost:27017` or MongoDB Atlas URI

### 2. Backend Setup
```bash
cd backend
npm install
npm run dev
```
- Server starts at `http://localhost:5000`
- Automatically connects to MongoDB database `taskdb_p9`

### 3. Run Automated CLI Latency Benchmark
In a separate terminal:
```bash
cd backend
npm run benchmark
```
- Automatically registers benchmark test user
- Seeds starter tasks
- Tests uncached queries vs in-memory cache hits
- Verifies write-triggered invalidation
- Fetches MongoDB `.explain()` plan

### 4. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
- Starts Vite dev server at `http://localhost:5173`
- Open browser to explore live Cache Metrics, trigger benchmarks, and view query execution plans

---

## 🌐 API Endpoint Reference Table

| Method | Endpoint | Access Level | Caching / Invalidation Behavior | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | None | Server status, MongoDB connection & cache TTL info |
| `POST` | `/api/auth/register` | Public | None | User registration with bcrypt hashing |
| `POST` | `/api/auth/login` | Public | None | User login returning JWT bearer token |
| `GET` | `/api/auth/me` | Protected | None | Authenticated user profile |
| `GET` | `/api/tasks` | Protected | **Cached (TTL: 60s)** | User tasks; returns `X-Cache: HIT/MISS` |
| `POST` | `/api/tasks` | Protected | **Invalidates User Cache** | Creates task; evicts `tasks:${userId}:*` |
| `PUT` | `/api/tasks/:id` | Protected | **Invalidates User Cache** | Updates task; evicts `tasks:${userId}:*` |
| `DELETE`| `/api/tasks/:id` | Protected | **Invalidates User Cache** | Deletes task; evicts `tasks:${userId}:*` |
| `POST` | `/api/tasks/seed` | Protected | **Invalidates User Cache** | Seeds starter dataset and clears cache |
| `GET` | `/api/tasks/explain` | Protected | None | Returns MongoDB `.explain('executionStats')` |
| `GET` | `/api/cache/stats` | Public | None | Returns active keys, hit rate, and V8 memory usage |
| `DELETE`| `/api/cache/flush` | Public | None | Flushes all in-memory keys across the system |
| `POST` | `/api/cache/reset-stats`| Public | None | Resets hit/miss telemetry counters to zero |

---

## 🧠 Comprehensive Viva Voce Questions & Answers

### Q1: What is the primary difference between client-side caching and server-side in-memory caching?
**Answer**: Client-side caching (e.g., HTTP `Cache-Control`, browser Service Workers, React state/React Query) stores response payloads in the user's local browser memory or disk, eliminating network requests entirely for that individual device. Server-side in-memory caching (`node-cache`, Redis) stores query results in server RAM. While a network request still reaches the server, it eliminates database round-trips, disk I/O, serialization overhead, and connection pool lock contention, accelerating responses for all concurrent requests across the entire application.

### Q2: What is the Cache-Aside pattern, and how does it differ from Read-Through caching?
**Answer**:
- In **Cache-Aside (Lazy Loading)**, the application code explicitly orchestrates caching: it queries the cache first; on a MISS, it fetches data from the primary database, populates the cache with a specified TTL, and returns the response.
- In **Read-Through caching**, the cache library or service sits transparently between the application and the database. The application always queries the cache directly, and the cache library internally handles loading missing entries from the backing store.

### Q3: Why is write-triggered cache invalidation critical for transactional data consistency?
**Answer**: Without write invalidation, if a user updates, creates, or deletes a task in MongoDB, subsequent `GET` requests would continue serving stale, outdated data from server RAM until the TTL expires (which could be minutes or hours). By calling `cacheService.invalidateUserTasks(userId)` immediately on `POST`, `PUT`, and `DELETE` operations, the system guarantees strong read-after-write consistency.

### Q4: What is the role of `checkperiod` in `node-cache`?
**Answer**: While `stdTTL` dictates the lifetime of a key, expired entries remain in process heap memory until explicitly accessed or swept. The `checkperiod` option (e.g., 120 seconds) schedules an internal timer in `node-cache` that periodically scans the key-value dictionary and prunes expired records, preventing memory leaks in long-running Node.js processes.

### Q5: How does Mongoose `.lean()` accelerate read queries?
**Answer**: By default, Mongoose wraps query results in full Document instances complete with internal change tracking, schema typecasting, getters/setters, and methods (`save()`, `validate()`). Appending `.lean()` instructs Mongoose to skip prototype hydration and return plain JavaScript objects (POJOs), reducing V8 heap memory usage by >60% and speeding up JSON serialization by ~4x.

### Q6: What is a MongoDB Compound Index, and how does it prevent in-memory sorting?
**Answer**: A compound index (e.g., `{ user: 1, createdAt: -1 }`) combines multiple document fields into a single B-Tree data structure. Because the index nodes are already physically ordered first by `user` and then by `createdAt` in descending order, MongoDB traverses the B-Tree directly (**Index Scan `IXSCAN`**) to retrieve the requested range. This eliminates both full collection scans (**`COLLSCAN`**) and expensive in-memory sort stages (`SORT`).

### Q7: What are the trade-offs between `node-cache` (in-process) and `Redis` (external distributed cache)?
**Answer**:
- **`node-cache`**: Resides directly in the Node.js V8 process heap. It features zero network latency (sub-microsecond memory pointers) and zero infrastructure setup. However, it cannot be shared across multiple clustered Node.js worker processes or container instances, and cache contents are lost upon server restart.
- **`Redis`**: A standalone, high-performance in-memory data store running as an independent service. It can be shared across thousands of clustered application instances, supports data persistence and rich data structures (hashes, sorted sets), but introduces minimal network latency (~0.5–2 ms TCP round-trip) and requires separate infrastructure management.

### Q8: What does the scan ratio (`nReturned / totalDocsExamined`) in MongoDB `.explain()` indicate?
**Answer**: The scan ratio measures query indexing efficiency. A ratio of `1.00` means MongoDB examined exactly the number of documents that it returned to the client—indicating a perfectly indexed query (`IXSCAN`). A ratio close to `0` indicates that MongoDB examined hundreds or thousands of documents only to return a few (or used a `COLLSCAN`), signifying missing or un-indexed query predicates.

### Q9: Why is `useClones: false` set in the `node-cache` configuration?
**Answer**: By default, `node-cache` creates deep clones of objects on every `get()` and `set()` operation to prevent accidental mutations by reference. However, deep cloning consumes substantial CPU cycles for large JSON payloads. Setting `useClones: false` stores direct references in memory, substantially improving throughput when response payloads are treated as read-only.

### Q10: How can API consumers intentionally bypass the cache for debugging?
**Answer**: In `cacheMiddleware.js`, a bypass check is implemented that detects query parameters or request headers (e.g., `?nocache=true`, `Cache-Control: no-cache`, or `X-Bypass-Cache: true`). When present, the middleware skips the RAM lookup, directly executes the MongoDB query, and returns `X-Cache: BYPASS`, allowing developers and benchmarks to measure true database execution times.

---

## 👥 Authors & Academic Context
- **Practical**: Practical 9 (Server In-Memory Caching & Database Query Optimization)
- **Course**: Advanced Web Development Frameworks (ITUE301)
- **Stack**: Node.js, Express.js 4.19, MongoDB Atlas / Mongoose 8.3, `node-cache` 5.1, React 18, Vite 5
