import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 1000 }, headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: [
    { env:{LOCAL_DEVICE_TESTING:'true',TEACHER_CLOSE_ON_EXIT:'false',DEVICE_PROVISIONING_PORT:'4198',NETSBLOX_SERVICES_URL:'http://127.0.0.1:4199'}, command: 'npm run start:api', url: 'http://127.0.0.1:3002/api/health', reuseExistingServer: false },
    { command: 'npm run dev:web -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
  ],
})
