import './fonts';
import { requestExpandedMode } from '@devvit/web/client';

document.getElementById('join')?.addEventListener('click', (event) => requestExpandedMode(event, 'game'));
