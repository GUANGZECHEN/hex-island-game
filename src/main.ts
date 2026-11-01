import './style.css';
import { Peer } from './peer';

function element<T extends HTMLElement>(id: string): T { const item = document.getElementById(id); if (!item) throw new Error(`Missing element ${id}`); return item as T; }
const remote = element<HTMLTextAreaElement>('remote'), local = element<HTMLTextAreaElement>('local');
const status = element<HTMLElement>('status'), error = element<HTMLElement>('error'), diagnostics = element<HTMLElement>('diagnostics');
const send = element<HTMLButtonElement>('send'), messages = element<HTMLUListElement>('messages'), message = element<HTMLInputElement>('message');
let generation = 0; let busy = false;
const peer = new Peer({ status: text => { status.textContent = text; }, error: text => { error.textContent = text; }, diagnostics: text => { diagnostics.textContent = text; }, ready: ready => { send.disabled = !ready; }, message: text => addMessage('Peer', text) });
function addMessage(who: string, text: string): void { const li = document.createElement('li'); li.textContent = `${who}: ${text}`; messages.append(li); }
async function run(action: () => Promise<void>): Promise<void> {
  if (busy) return; busy = true; error.textContent = ''; const current = generation;
  try { await action(); } catch (cause) { if (current === generation) error.textContent = cause instanceof Error ? cause.message : String(cause); } finally { busy = false; }
}
element('create').addEventListener('click', () => void run(async () => { const current = generation; status.textContent = 'Gathering offer candidates…'; const data = await peer.create(); if (current === generation) local.value = data; }));
element('join').addEventListener('click', () => void run(async () => { const current = generation; status.textContent = 'Gathering answer candidates…'; const data = await peer.join(remote.value); if (current === generation) local.value = data; }));
element('apply').addEventListener('click', () => void run(() => peer.apply(remote.value)));
element('reset').addEventListener('click', () => { generation++; peer.reset(); local.value = ''; remote.value = ''; message.value = ''; messages.replaceChildren(); error.textContent = ''; });
element('copy').addEventListener('click', () => void run(async () => { if (!local.value) throw new Error('No connection data to copy yet.'); if (!navigator.clipboard) throw new Error('Clipboard unavailable. Select and copy the connection data manually.'); await navigator.clipboard.writeText(local.value); status.textContent = 'Connection data copied.'; }));
element<HTMLFormElement>('message-form').addEventListener('submit', event => { event.preventDefault(); if (!message.value) return; try { peer.send(message.value); addMessage('You', message.value); message.value = ''; error.textContent = ''; } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); } });
