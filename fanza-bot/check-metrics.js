/**
 * 投稿指標を更新してレポートを表示する
 * 使い方: node check-metrics.js
 */

import 'dotenv/config';
import { refreshRecentMetrics, printReport } from './lib/analytics.js';

(async () => {
  console.log('\n📊 指標を更新中...\n');
  await refreshRecentMetrics();
  printReport();
})();
