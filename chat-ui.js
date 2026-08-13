const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;

export function renderTextWithLinks(container, text) {
  const document = container.ownerDocument;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    fragment.append(document.createTextNode(text.slice(lastIndex, match.index)));

    const link = document.createElement("a");
    link.href = match[0];
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = match[0];
    fragment.append(link);

    lastIndex = match.index + match[0].length;
  }

  fragment.append(document.createTextNode(text.slice(lastIndex)));
  container.replaceChildren(fragment);
}
