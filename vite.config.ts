import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
const target = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3001'
const proxy = { '/api': { target, ws: true }, '/rpc': { target } }
export default defineConfig({ plugins: [react()], server: { proxy }, preview: { proxy } })
