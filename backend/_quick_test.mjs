// Quick test: verify server module can load without errors
try {
  await import('./server.js');
  console.log('✅ server.js loaded successfully');
} catch (e) {
  console.error('❌ server.js load FAILED:', e.message);
}
