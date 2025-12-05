// Content script for Amazon Tracking page
// Captures tracking number and links it to the order

(function() {
  'use strict';

  function extractTrackingInfo() {
    const trackingInfo = {
      trackingId: null,
      carrier: null,
      orderId: null,
      itemName: null
    };

    const pageText = document.body.innerText;
    const pageUrl = window.location.href;

    // Extract Order ID from URL
    const orderIdMatch = pageUrl.match(/orderId=(\d{3}-\d{7}-\d{7})/);
    if (orderIdMatch) {
      trackingInfo.orderId = orderIdMatch[1];
    }

    // Also try from page text
    if (!trackingInfo.orderId) {
      const textOrderMatch = pageText.match(/(\d{3}-\d{7}-\d{7})/);
      if (textOrderMatch) {
        trackingInfo.orderId = textOrderMatch[1];
      }
    }

    // Extract Tracking ID - various patterns
    const trackingPatterns = [
      // "Tracking ID: XXXXXXX"
      /Tracking\s*(?:ID|Number|#)?[:\s]+([A-Z0-9]{10,30})/i,
      // UPS: 1Z...
      /\b(1Z[A-Z0-9]{16})\b/,
      // USPS: 20-22 digits or starting with 94
      /\b(9[0-9]{15,21})\b/,
      // FedEx: 12-14 or 20-22 digits
      /\b(\d{12,14})\b/,
      /\b(\d{20,22})\b/,
      // Generic alphanumeric tracking
      /tracking[:\s]+([A-Z0-9]{8,30})/i
    ];

    for (const pattern of trackingPatterns) {
      const match = pageText.match(pattern);
      if (match) {
        trackingInfo.trackingId = match[1];
        break;
      }
    }

    // Extract Carrier
    const carrierPatterns = [
      /shipped\s+(?:with|via)\s+(UPS|FedEx|USPS|DHL|Amazon|OnTrac|LaserShip)/i,
      /(UPS|FedEx|USPS|DHL|OnTrac|LaserShip|Amazon Logistics)/i
    ];

    for (const pattern of carrierPatterns) {
      const match = pageText.match(pattern);
      if (match) {
        trackingInfo.carrier = match[1];
        break;
      }
    }

    // Try to get item name from page
    const itemLinks = document.querySelectorAll('a[href*="/gp/product/"], a[href*="/dp/"]');
    if (itemLinks.length > 0) {
      trackingInfo.itemName = itemLinks[0].innerText.trim();
    }

    return trackingInfo;
  }

  function saveTrackingInfo(trackingInfo) {
    if (!trackingInfo.trackingId || !trackingInfo.orderId) {
      console.log('Parcel Tracker: Missing tracking ID or order ID', trackingInfo);
      return;
    }

    chrome.storage.local.get(['orders', 'trackingMap'], (result) => {
      const orders = result.orders || {};
      const trackingMap = result.trackingMap || {};

      // Update the order with tracking info
      if (orders[trackingInfo.orderId]) {
        orders[trackingInfo.orderId].trackingId = trackingInfo.trackingId;
        orders[trackingInfo.orderId].carrier = trackingInfo.carrier;
        orders[trackingInfo.orderId].trackingUpdated = new Date().toISOString();
      } else {
        // Create a new order entry if it doesn't exist
        orders[trackingInfo.orderId] = {
          orderId: trackingInfo.orderId,
          trackingId: trackingInfo.trackingId,
          carrier: trackingInfo.carrier,
          items: trackingInfo.itemName ? [{ name: trackingInfo.itemName, quantity: 1 }] : [],
          lastUpdated: new Date().toISOString()
        };
      }

      // Also maintain a tracking -> order map for reverse lookup
      trackingMap[trackingInfo.trackingId] = {
        orderId: trackingInfo.orderId,
        carrier: trackingInfo.carrier,
        capturedAt: new Date().toISOString()
      };

      chrome.storage.local.set({ orders, trackingMap }, () => {
        console.log('Parcel Tracker: Linked tracking', trackingInfo.trackingId, 'to order', trackingInfo.orderId);
        showNotification('Tracking captured: ' + trackingInfo.trackingId);
      });
    });
  }

  function showNotification(message) {
    let badge = document.getElementById('parcel-tracker-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'parcel-tracker-badge';
      badge.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #232f3e;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: opacity 0.3s;
      `;
      document.body.appendChild(badge);
    }

    badge.textContent = '📦 ' + message;
    badge.style.opacity = '1';

    setTimeout(() => {
      badge.style.opacity = '0';
    }, 3000);
  }

  // Add a capture button
  function addCaptureButton() {
    if (document.getElementById('parcel-tracker-capture-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'parcel-tracker-capture-btn';
    btn.innerHTML = '📦 Capture Tracking';
    btn.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: #ff9900;
      color: #111;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    `;

    btn.addEventListener('click', () => {
      const info = extractTrackingInfo();
      console.log('Parcel Tracker: Extracted tracking info:', info);
      saveTrackingInfo(info);
    });

    document.body.appendChild(btn);
  }

  function init() {
    console.log('Parcel Tracker: Tracking page content script loaded');
    addCaptureButton();

    // Auto-extract with delay
    setTimeout(() => {
      const info = extractTrackingInfo();
      if (info.trackingId) {
        saveTrackingInfo(info);
      }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
