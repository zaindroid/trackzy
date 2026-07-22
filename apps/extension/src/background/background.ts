const POLL_ALARM_NAME = 'fulfillment-tracker-poll';

// Keeps the service worker's periodic wakeups registered; content scripts
// poll on their own page-load, so this alarm is a placeholder hook for a
// future badge-count update (e.g. showing the Buy Queue size on the toolbar
// icon) rather than doing any fetching itself in this scaffold.
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM_NAME) return;
  // TODO(HUMAN): wire this to update the toolbar badge with the current Buy
  // Queue / pending-tracking-upload count via chrome.action.setBadgeText.
});
