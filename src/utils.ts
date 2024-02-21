export function sortDate (a, b) {
  let aDate = new Date(a.date);
  let bDate = new Date(b.date);
  if (aDate < bDate) {
    return 1;
  } else if (aDate === bDate) {
    return 0;
  } else {
    return -1;
  }
};

export function buildProxyURL(baseURL, tag) {
  const url = new URL(`/proxy/${tag}`, baseURL);
  return url.toString();
}

export function createPostMarkdown(post) {
  return `<b>${post.title}</b>
<a href="${post.link}">Read.</a>
    
- \#${post.tag}`;
}
