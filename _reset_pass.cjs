// Reset admin password in Supabase
const crypto = require('crypto');

// Generate new password hash using same algorithm as auth.js
const password = 'Andrada_1968!';
const salt = crypto.randomBytes(32).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
const password_hash = hash + ':' + salt;

console.log('New password_hash for Andrada_1968!:');
console.log(password_hash);
console.log('\nSQL to run in Supabase SQL Editor:');
console.log(`UPDATE users SET password_hash = '${password_hash}' WHERE email = 'adrianenc11@gmail.com';`);
