// Kelion Browser Extension — service worker (Manifest V3).

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-kelion') {
    chrome.tabs.create({ url: 'https://kelionai.app' })
  }
})

chrome.action.onClicked.addListener(() => {
  // Fallback if the user clicks the icon outside the popup (rare in MV3).
  chrome.tabs.create({ url: 'https://kelionai.app' })
})
