// Background service worker for Parcel Tracker

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ORDER_CAPTURED') {
    console.log('Order captured:', message.data);
  }

  if (message.type === 'TRACKING_CAPTURED') {
    console.log('Tracking captured:', message.data);
  }

  sendResponse({ received: true });
});

// Set up context menu for quick actions
chrome.runtime.onInstalled.addListener(() => {
  console.log('Parcel Tracker extension installed');
});
