// Mimics the inline-menu pattern used by password managers (Bitwarden, 1Password,
// LastPass), grammar checkers and shopping assistants: an <iframe> whose src is
// one of this extension's own pages. Its presence alone is what breaks
// chrome.debugger.attach for every OTHER extension on the tab.
const frame = document.createElement("iframe");
frame.id = "foreign-ext-frame";
frame.src = chrome.runtime.getURL("frame.html");
frame.style.cssText = "position:fixed;bottom:8px;right:8px;width:120px;height:40px;border:0";
document.documentElement.appendChild(frame);
