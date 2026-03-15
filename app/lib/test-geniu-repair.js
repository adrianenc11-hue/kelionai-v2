// A test file for Geniu AI Fixer
// This file contains a clear Async Error that should be detected and fixed.
async function fetchUserData(userId) {
  // Missing error handling / try-catch
  /* /* /* /* /* console.log('Fetching user data for', userId); (removed) */ (removed) */ (removed) */ (removed) */ (removed) */
  const response = await fetch('https://api.example.com/users/' + userId);
  const data = await response.json();
  return data;
}

module.exports = { fetchUserData };
