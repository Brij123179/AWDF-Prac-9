import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import { requestLogger } from './middleware/logger.js';
import { validateContentType } from './middleware/validateContentType.js';
import { notFoundHandler, globalErrorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/authRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import cacheRoutes from './routes/cacheRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Global Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(validateContentType);
app.use(requestLogger);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'Practical 9 Express, MongoDB, node-cache In-Memory Caching & Query Optimization Backend',
    database: 'MongoDB (taskdb_p9)',
    caching: 'node-cache In-Memory Caching (TTL: 60s)',
    timestamp: new Date().toISOString()
  });
});

// Network Delay Simulation Endpoint (demonstrates latency & fallback states)
app.get('/api/performance/simulate-delay', (req, res) => {
  const delayMs = parseInt(req.query.ms, 10) || 1200;
  setTimeout(() => {
    res.status(200).json({
      success: true,
      simulatedDelayMs: delayMs,
      message: `Response delayed by ${delayMs}ms for testing loading fallbacks and async metrics.`,
      serverTimestamp: new Date().toISOString()
    });
  }, delayMs);
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/cache', cacheRoutes);

// Error Handling Middlewares
app.use(notFoundHandler);
app.use(globalErrorHandler);

app.listen(PORT, () => {
  console.log(`
🚀 Practical 9 Server running on http://localhost:${PORT}
🍃 Connected to MongoDB 'taskdb_p9' via Mongoose ODM
⚡ Backend: In-Memory Caching (node-cache) & Query Optimization (Compound Index & .lean())
🔐 Auth REST:    http://localhost:${PORT}/api/auth
📋 Tasks REST:   http://localhost:${PORT}/api/tasks (Cached GET /tasks)
📊 Cache REST:   http://localhost:${PORT}/api/cache/stats
🔍 Explain:      http://localhost:${PORT}/api/tasks/explain
📂 Projects REST: http://localhost:${PORT}/api/projects
📬 Contact REST:  http://localhost:${PORT}/api/contact
  `);
});

export default app;
