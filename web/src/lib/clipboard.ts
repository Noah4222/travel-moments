import { showToast } from "./toast";

/**
 * Copy text to clipboard. On success show a toast; on failure stay silent
 * (UX requirement — don't nag the user when the browser blocks clipboard).
 */
export async function copyText(text: string, successMsg = "已复制 ✨ 快去粘贴吧") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg, "success");
  } catch {
    /* swallow */
  }
}

// 小红书风格文案 ✨
export function composeTripShareCopy(title: string, link: string) {
  return `✨ 快来云逛我的「${title}」相册～📸 一起看看这趟旅行的小确幸吧！🌍✈️\n${link}`;
}

export function composeCollectionShareCopy(title: string, link: string) {
  return `📸 精选了一些超出片的瞬间送给你～✨「${title}」一键查看 👇\n${link}`;
}

export function composeMultiShareCopy(link: string) {
  return `🌟 一次打包了好几本旅行相册～📚✨ 慢慢翻，跟我一起云旅行 🌍\n${link}`;
}

export function composeAssetShareCopy(link: string) {
  return `📷 这一张超喜欢～偷偷分享给你看看 ✨\n${link}`;
}

export function composeForwardCopy(title: string | undefined, link: string) {
  if (title) {
    return `🌟 强推这本「${title}」旅行相册～📸 超治愈，一起来看看吧 ✨\n${link}`;
  }
  return `🌟 强推一本旅行相册～📸 超治愈，一起来看看吧 ✨\n${link}`;
}

export function composeUploadCopy(title: string, link: string) {
  return `📸 赶紧上传你的照片到「${title}」相册，跟好朋友一起分享旅行的快乐吧～✨🌟\n${link}`;
}
