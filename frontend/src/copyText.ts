export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);

    let copied = false;
    try {
      textArea.select();
      copied = document.execCommand('copy');
    } finally {
      textArea.remove();
    }

    if (!copied) throw new Error('Não foi possível copiar o link da proposta.');
  }
}
