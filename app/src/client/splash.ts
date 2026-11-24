import './fonts';
import { requestExpandedMode } from '@devvit/web/client';
import type { Envelope, FeudInfo } from '../shared/rules.ts';

document.getElementById('join')?.addEventListener('click', (event) => requestExpandedMode(event, 'game'));

// Show today's feud. If the server can't be reached the card keeps its default text and still opens the game.
async function showFeud(): Promise<void> {
  try {
    const res = await fetch('/api/feud');
    const out = (await res.json()) as Envelope<FeudInfo>;
    if (!out.ok) return;
    const set = (id: string, text: string) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('question', out.data.question);
    set('nameA', out.data.sides.a);
    set('nameB', out.data.sides.b);
    const last = out.data.rematch;
    set('brand', last ? `Feudlands, day ${out.data.day}: a rematch` : `Feudlands, day ${out.data.day}`);
  } catch (error) {
    console.warn('Could not load today’s feud', error);
  }
}
void showFeud();
