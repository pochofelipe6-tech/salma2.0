import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./tests',
  fullyParallel:false,
  use:{baseURL:'http://localhost:3000',channel:'msedge',headless:true},
  reporter:'list',
  webServer:{command:'npm run dev',url:'http://localhost:3000',reuseExistingServer:true},
});
