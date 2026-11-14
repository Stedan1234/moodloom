// Right-click → "Save to Moodloom". Saves the image, link or page under the
// cursor into the project last used from the popup, without opening anything.
import { api, getSettings } from './api.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'moodloom-save', title: 'Save to Moodloom', contexts: ['image', 'link', 'page', 'video'] });
});

function flash(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'moodloom-save') return;
  try {
    const { token, last } = await getSettings();
    if (!token || !last.projectId) {
      // Nothing to save into yet: the popup is where pairing and choosing happen.
      flash('!', '#b83f27');
      return;
    }
    const sourceUrl = info.srcUrl || info.linkUrl || info.pageUrl || tab?.url;
    if (!/^https?:\/\//i.test(sourceUrl || '')) return flash('!', '#b83f27');
    await api.capture(last.projectId, {
      sourceUrl,
      // For an image or link, remember the page it was found on.
      pageUrl: sourceUrl !== tab?.url && /^https?:\/\//i.test(tab?.url || '') ? tab.url : undefined,
      title: info.srcUrl || info.linkUrl ? undefined : tab?.title?.slice(0, 300),
      categoryId: last.categoryId || undefined,
    });
    flash('✓', '#17332d');
  } catch {
    flash('!', '#b83f27');
  }
});
