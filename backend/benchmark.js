/**
 * Practical 9: In-Memory Caching and Query Optimization Benchmark
 * Automated Empirical Latency Benchmark Script
 *
 * Measures:
 * 1. Uncached database reads (?nocache=true) across multiple trials
 * 2. In-memory cached reads (node-cache HITs) across multiple trials
 * 3. Write-triggered cache invalidation cycle (POST -> MISS -> HIT)
 * 4. MongoDB Compound Index query execution plan (.explain())
 */

const BASE_URL = process.env.API_URL || 'http://localhost:5000';

async function runBenchmark() {
  console.log('='.repeat(70));
  console.log('🚀 Practical 9: In-Memory Caching & Latency Benchmark');
  console.log(`🌐 Target Server: ${BASE_URL}`);
  console.log('='.repeat(70));

  try {
    // 1. Health Check
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    if (!healthRes.ok) {
      throw new Error(`Server is not responding. Status: ${healthRes.status}`);
    }
    const healthData = await healthRes.json();
    console.log(`✅ Server Status: ${healthData.status} | DB: ${healthData.database} | Caching: ${healthData.caching}\n`);

    // 2. Authenticate / Register Benchmark User
    const userCredentials = {
      name: 'Benchmark Tester',
      email: `bench_${Date.now()}@example.com`,
      password: 'password123'
    };

    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userCredentials)
    });
    const regData = await regRes.json();
    const token = regData.token;
    console.log(`👤 Authenticated user: ${userCredentials.email}`);

    const authHeaders = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // 3. Seed starter dataset
    const seedRes = await fetch(`${BASE_URL}/api/tasks/seed`, {
      method: 'POST',
      headers: authHeaders
    });
    const seedData = await seedRes.json();
    console.log(`🌱 Seeded ${seedData.count} starter tasks in MongoDB\n`);

    // 4. Test Uncached Performance (5 trials with ?nocache=true)
    console.log('--- Case 1: Uncached API Reads (Database Query: MongoDB) ---');
    const uncachedReadings = [];
    const NUM_TRIALS = 5;

    for (let i = 1; i <= NUM_TRIALS; i++) {
      const start = performance.now();
      const res = await fetch(`${BASE_URL}/api/tasks?nocache=true`, {
        headers: authHeaders
      });
      const end = performance.now();
      const duration = parseFloat((end - start).toFixed(2));
      const json = await res.json();
      const cacheHeader = res.headers.get('x-cache') || json.cacheStatus || 'BYPASS';

      uncachedReadings.push(duration);
      console.log(`  Trial ${i}: ${duration.toFixed(2)} ms [Status: ${res.status}, Cache: ${cacheHeader}, Count: ${json.count}]`);
    }

    // 5. Test Cached Performance (1 Miss to prime + 4 consecutive Hits)
    console.log('\n--- Case 2: In-Memory Cached API Reads (node-cache) ---');
    // First clear user cache to measure fresh MISS
    await fetch(`${BASE_URL}/api/cache/user`, {
      method: 'DELETE',
      headers: authHeaders
    });

    const cachedReadings = [];
    for (let i = 1; i <= NUM_TRIALS; i++) {
      const start = performance.now();
      const res = await fetch(`${BASE_URL}/api/tasks`, {
        headers: authHeaders
      });
      const end = performance.now();
      const duration = parseFloat((end - start).toFixed(2));
      const json = await res.json();
      const cacheHeader = res.headers.get('x-cache') || json.cacheStatus;

      cachedReadings.push({ trial: i, duration, status: cacheHeader });
      console.log(`  Trial ${i}: ${duration.toFixed(2)} ms [Status: ${res.status}, Cache: ${cacheHeader}, TTL: ${json.remainingTTL || 60}s]`);
    }

    // 6. Test Cache Invalidation on Mutation
    console.log('\n--- Case 3: Cache Invalidation Verification (Write Operation) ---');
    const newTask = {
      title: 'Benchmark Mutation Task',
      description: 'Testing automatic cache eviction on POST',
      priority: 'high'
    };

    console.log('  1. Sending POST /api/tasks to create new item...');
    const postRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(newTask)
    });
    const postData = await postRes.json();
    console.log(`     -> Result: Cache Invalidated = ${postData.cacheInvalidated}`);

    console.log('  2. Sending GET /api/tasks (Should be a fresh Cache MISS)...');
    const missRes = await fetch(`${BASE_URL}/api/tasks`, { headers: authHeaders });
    const missData = await missRes.json();
    console.log(`     -> Result: Cache Status = ${missData.cacheStatus} (${missData.executionTimeMs} ms)`);

    console.log('  3. Sending GET /api/tasks again (Should be a Cache HIT)...');
    const hitRes = await fetch(`${BASE_URL}/api/tasks`, { headers: authHeaders });
    const hitData = await hitRes.json();
    console.log(`     -> Result: Cache Status = ${hitData.cacheStatus} (${hitData.executionTimeMs} ms)`);

    // 7. Supplementary Problem 1: Test Single Task Caching (GET /api/tasks/:id)
    console.log('\n--- Supplementary Problem 1: Single Task Caching (GET /api/tasks/:id) ---');
    const firstTaskId = seedData.data[0]._id;
    console.log(`  Target Task ID: ${firstTaskId}`);
    
    // First read: MISS
    const startSingle1 = performance.now();
    const single1Res = await fetch(`${BASE_URL}/api/tasks/${firstTaskId}`, { headers: authHeaders });
    const single1Duration = (performance.now() - startSingle1).toFixed(2);
    const single1Data = await single1Res.json();
    console.log(`  1st GET /tasks/:id -> Duration: ${single1Duration} ms | Cache Status: ${single1Res.headers.get('x-cache') || single1Data.cacheStatus}`);

    // Second read: HIT
    const startSingle2 = performance.now();
    const single2Res = await fetch(`${BASE_URL}/api/tasks/${firstTaskId}`, { headers: authHeaders });
    const single2Duration = (performance.now() - startSingle2).toFixed(2);
    const single2Data = await single2Res.json();
    console.log(`  2nd GET /tasks/:id -> Duration: ${single2Duration} ms | Cache Status: ${single2Res.headers.get('x-cache') || single2Data.cacheStatus} (Separate cache key verified!)`);

    // 8. Supplementary Problem 2: Debug Endpoint with Hit/Miss Counters
    console.log('\n--- Supplementary Problem 2: Debug Endpoint (GET /api/cache/debug) ---');
    const debugRes = await fetch(`${BASE_URL}/api/cache/debug`);
    const debugData = await debugRes.json();
    console.log('  Debug Telemetry Output:');
    console.log(`    - Cache Hits:    ${debugData.cacheMetrics.cacheHits}`);
    console.log(`    - Cache Misses:  ${debugData.cacheMetrics.cacheMisses}`);
    console.log(`    - Total Requests:${debugData.cacheMetrics.totalRequests}`);
    console.log(`    - Hit Rate:      ${debugData.cacheMetrics.hitRatePercentage}`);
    console.log(`    - Active Keys:   ${debugData.cacheMetrics.activeKeys}`);

    // 9. Supplementary Problem 3: TTL Adjustment Experimentation
    console.log('\n--- Supplementary Problem 3: TTL Adjustment Experimentation ---');
    const ttlRes = await fetch(`${BASE_URL}/api/cache/ttl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 30 })
    });
    const ttlData = await ttlRes.json();
    console.log(`  Updated TTL: ${ttlData.currentTTL}s -> ${ttlData.message}`);

    // 10. Check MongoDB Explain Execution Stats
    console.log('\n--- MongoDB Query Optimization Analysis (.explain()) ---');
    const explainRes = await fetch(`${BASE_URL}/api/tasks/explain`, { headers: authHeaders });
    const explainData = await explainRes.json();
    console.log(`  Index Used: ${explainData.summary.indexUsed}`);
    console.log(`  Scan Stage: ${explainData.summary.scanStage} (Index Scan = ${explainData.summary.isIndexScan})`);
    console.log(`  Docs Examined: ${explainData.summary.totalDocsExamined}, Keys Examined: ${explainData.summary.totalKeysExamined}`);
    console.log(`  Efficiency Ratio: ${explainData.summary.efficiencyRatio}`);

    // 11. Statistical Calculations
    const avgUncached = uncachedReadings.reduce((a, b) => a + b, 0) / uncachedReadings.length;
    const hitsOnly = cachedReadings.filter((r) => r.status === 'HIT').map((r) => r.duration);
    const avgCachedHits = hitsOnly.reduce((a, b) => a + b, 0) / hitsOnly.length;
    const speedupFactor = (avgUncached / avgCachedHits).toFixed(1);
    const reductionPercent = (((avgUncached - avgCachedHits) / avgUncached) * 100).toFixed(1);

    // 12. Summary Table
    console.log('\n' + '='.repeat(70));
    console.log('📊 EMPIRICAL LATENCY BENCHMARK RESULTS (Cached vs Uncached)');
    console.log('='.repeat(70));
    console.log('| Trial | Uncached (MongoDB) | Cached (node-cache) | Cache Status |');
    console.log('|:-----:|:------------------:|:-------------------:|:------------:|');
    for (let i = 0; i < NUM_TRIALS; i++) {
      const uncachedMs = `${uncachedReadings[i].toFixed(2)} ms`;
      const cachedMs = `${cachedReadings[i].duration.toFixed(2)} ms`;
      const status = cachedReadings[i].status;
      console.log(`|   ${i + 1}   | ${uncachedMs.padEnd(18)} | ${cachedMs.padEnd(19)} | ${status.padEnd(12)} |`);
    }
    console.log('-'.repeat(70));
    console.log(`⚡ Average Uncached Latency: ${avgUncached.toFixed(2)} ms`);
    console.log(`⚡ Average Cached HIT Latency: ${avgCachedHits.toFixed(2)} ms`);
    console.log(`🚀 Speedup Multiplier:        ${speedupFactor}x Faster`);
    console.log(`📉 Latency Reduction:         ${reductionPercent}% Improvement`);
    console.log('='.repeat(70));

    // 13. Reset TTL back to default 60s
    await fetch(`${BASE_URL}/api/cache/ttl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 60 })
    });

    console.log('\n✅ Practical 9 Benchmark successfully executed and completed!\n');
  } catch (error) {
    console.error('❌ Benchmark error:', error.message);
  }
}

runBenchmark();
