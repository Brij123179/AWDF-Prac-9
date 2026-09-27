const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE_URL = 'http://localhost:5000';
const FRONTEND_URL = 'http://localhost:5173';

async function main() {
  console.log('🚀 Starting Screenshot Capture for Practical 9...');

  // 1. Authenticate user in backend
  const userCredentials = {
    name: 'Alex Johnson',
    email: 'alex.practical9@example.com',
    password: 'password123'
  };

  let token = null;
  let user = null;

  try {
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userCredentials)
    });
    const regData = await regRes.json();
    if (regData.token) {
      token = regData.token;
      user = regData.user;
    } else {
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userCredentials.email, password: userCredentials.password })
      });
      const loginData = await loginRes.json();
      token = loginData.token;
      user = loginData.user;
    }
  } catch (err) {
    console.error('Auth error:', err);
  }

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 2. Seed starter tasks
  await fetch(`${BASE_URL}/api/tasks/seed`, {
    method: 'POST',
    headers: authHeaders
  });

  // 3. Make multiple GET requests to generate Cache Hits
  for (let i = 0; i < 6; i++) {
    await fetch(`${BASE_URL}/api/tasks`, { headers: authHeaders });
  }

  // 4. Launch browser
  const browser = await chromium.launch({
    executablePath: EDGE_PATH,
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 1.5
  });

  const page = await context.newPage();

  // Navigate to frontend and inject auth token into localStorage
  await page.goto(FRONTEND_URL);
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('p9_token', token);
    localStorage.setItem('p9_user', JSON.stringify(user));
  }, { token, user });

  // Reload to apply authenticated session
  await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Screenshot 1: Tasks Dashboard with In-Memory Cache Active
  console.log('📸 Capturing ss/01_tasks_dashboard.png...');
  await page.screenshot({ path: 'ss/01_tasks_dashboard.png' });

  // Screenshot 2: Open Benchmark Modal & Run Benchmark
  console.log('📸 Capturing ss/02_cache_benchmark_modal.png...');
  const benchBtn = page.locator('button:has-text("Latency Benchmark")').first();
  await benchBtn.click();
  await page.waitForTimeout(600);
  
  // Click Run Live Latency Benchmark inside modal
  const runBenchBtn = page.locator('button:has-text("Run Live Latency Benchmark")').first();
  await runBenchBtn.click();
  // Wait for 10 trials to complete
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'ss/02_cache_benchmark_modal.png' });

  // Close benchmark modal
  const closeBenchBtn = page.locator('button:has-text("✕"), .modal-overlay button').first();
  await closeBenchBtn.click();
  await page.waitForTimeout(500);

  // Screenshot 3: Open Explain Query Modal
  console.log('📸 Capturing ss/03_explain_query_modal.png...');
  const explainBtn = page.locator('button:has-text("Query .explain()")').first();
  await explainBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'ss/03_explain_query_modal.png' });

  // Close explain modal
  const closeExplainBtn = page.locator('button:has-text("✕"), .modal-overlay button').first();
  await closeExplainBtn.click();
  await page.waitForTimeout(500);

  // Screenshot 4: Performance Page
  console.log('📸 Capturing ss/04_performance_page.png...');
  await page.goto(`${FRONTEND_URL}/performance`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'ss/04_performance_page.png' });

  // Screenshot 5: Debug Endpoint Telemetry (Supplementary Problem 2)
  console.log('📸 Capturing ss/05_debug_endpoint_telemetry.png...');
  // We can render a formatted page or view the JSON endpoint in browser
  await page.goto(`${BASE_URL}/api/cache/debug`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'ss/05_debug_endpoint_telemetry.png' });

  // Screenshot 6: Architecture & Coursera Theory Documentation
  console.log('📸 Capturing ss/06_about_architecture.png...');
  await page.goto(`${FRONTEND_URL}/about`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'ss/06_about_architecture.png' });

  await browser.close();
  console.log('🎉 All 6 Practical 9 screenshots captured successfully!');
}

main().catch(console.error);
