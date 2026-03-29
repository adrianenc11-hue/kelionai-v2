// Generate self-signed cert for localhost dev HTTPS
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const certDir = path.join(__dirname, '..', 'server', 'dev-cert');
fs.mkdirSync(certDir, { recursive: true });

const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('Cert already exists, skipping');
  process.exit(0);
}

const openssl = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
execFileSync(openssl, [
  'req', '-x509', '-newkey', 'rsa:2048',
  '-keyout', keyPath,
  '-out', certPath,
  '-days', '3650',
  '-nodes',
  '-subj', '/CN=localhost'
], { stdio: 'inherit' });

console.log('Dev cert generated at', certDir);
