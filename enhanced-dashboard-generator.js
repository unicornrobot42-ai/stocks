#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// Screener tickers to scan
const TICKER_LIST = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'AVGO', 'NFLX', 'NZAK', 
  'ASML', 'ADBE', 'COST', 'CSCO', 'VRTX', 'AMD', 'MU', 'SCHW', 'INTC', 'PYPL',
  'GD', 'LMT', 'RTX', 'NOC', 'BA', 'GIS', 'MO', 'PM', 'UPS', 'FDX',
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'USB', 'PNC', 'TD', 'BLK',
  'UNH', 'JNJ', 'AZN', 'LLY', 'MRVL', 'BEAM', 'TMDX', 'VEEV', 'DKNG', 'ROKU',
  'NTES', 'BIDU', 'VGT', 'VUG', 'SPY', 'QQQ', 'IWM', 'SLV', 'GLD', 'HUT'
];

function fetchStockData(ticker) {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v7/finance/download/${ticker}?period1=1746230400&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=history`;
    
    https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const lines = data.split('\n').filter(l => l.trim() && !l.startsWith('Date'));
          const prices = lines.slice(0, 90).reverse().map(l => {
            const parts = l.split(',');
            return parseFloat(parts[4]);
          }).filter(p => !isNaN(p));
          
          if (prices.length < 27) {
            resolve(null);
            return;
          }
          
          const ma9 = prices.slice(0, 9).reduce((a, b) => a + b) / 9;
          const ma27 = prices.slice(0, 27).reduce((a, b) => a + b) / 27;
          const ma5_5days = prices.slice(0, 5).map((p, i) => {
            const s = prices.slice(i, i + 9).reduce((a, b) => a + b) / 9;
            return s;
          });
          
          const current = prices[0];
          const vol20 = data.split('\n').slice(1, 21).map(l => parseInt(l.split(',')[6]) || 0).reduce((a, b) => a + b) / 20;
          const currentVol = parseInt(data.split('\n')[1].split(',')[6]) || 0;
          const prev5DaysVol = data.split('\n').slice(1, 6).map(l => parseInt(l.split(',')[6]) || 0).reduce((a, b) => a + b) / 5;
          
          const lastClose = prices[0];
          const prevClose = prices[1];
          const uptrending = prices[0] >= ma9 * 0.99 && prices[1] >= ma9 * 0.99 && prices[2] >= ma9 * 0.99;
          
          const crossedRecently = ma9 > ma27 && prices[5] < prices[5]; // Simplified
          const ma5Avg = ma5_5days.reduce((a, b) => a + b) / ma5_5days.length;
          const ma9Trending = ma9 > ma5Avg;
          
          resolve({
            ticker,
            current,
            ma9,
            ma27,
            gap: ((ma9 - ma27) / ma27 * 100).toFixed(2),
            gapNum: parseFloat(((ma9 - ma27) / ma27 * 100).toFixed(2)),
            volume: currentVol,
            volRatio: (currentVol / vol20).toFixed(2),
            volRatioNum: parseFloat((currentVol / vol20).toFixed(2)),
            uptrending,
            ma9Trending
          });
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

function classifySignal(stock) {
  if (!stock) return null;
  
  const gap = stock.gapNum;
  const volRatio = stock.volRatioNum;
  
  // Deal-killers
  if (gap < -5 || volRatio < 1.1 || !stock.uptrending) return null;
  
  // FRESH CROSSOVER
  if (gap >= 0 && gap <= 5 && stock.uptrending && volRatio >= 1.2) {
    return {
      type: 'FRESH',
      confidence: Math.min(95, 80 + (volRatio - 1.2) * 50),
      priority: 1
    };
  }
  
  // IMMINENT CROSSOVER
  if (gap >= -5 && gap < 0 && stock.uptrending && volRatio >= 1.1) {
    return {
      type: 'IMMINENT',
      confidence: Math.min(90, 70 + (volRatio - 1.1) * 50),
      priority: 2
    };
  }
  
  // EARLY CROSSOVER
  if (gap > 5 && gap <= 15 && stock.uptrending) {
    return {
      type: 'EARLY',
      confidence: 60,
      priority: 3
    };
  }
  
  // ESTABLISHED
  if (gap > 15 && stock.uptrending) {
    return {
      type: 'ESTABLISHED',
      confidence: 50,
      priority: 4
    };
  }
  
  return null;
}

async function generateEnhancedDashboard() {
  const portfolio = {
    'NFLX': {
      entry: 97.09,
      entryDate: '2026-03-03',
      target5: 102,
      target10: 107,
      target20: 116,
      stopLoss: 89.30,
      allocation: 400
    },
    'GD': {
      entry: 364.78,
      entryDate: '2026-03-03',
      target5: 383,
      target10: 401,
      target20: 437,
      stopLoss: 335.60,
      allocation: 350
    },
    'MRVL': {
      entry: 80.86,
      entryDate: '2026-03-03',
      target5: 85,
      target10: 89,
      target20: 97,
      stopLoss: 74.40,
      allocation: 250
    }
  };

  // Scan for buy signals
  console.log('Scanning for buy signals...');
  const buySignals = [];
  
  for (const ticker of TICKER_LIST) {
    const stock = await fetchStockData(ticker);
    if (!stock) continue;
    
    const signal = classifySignal(stock);
    if (signal && !Object.keys(portfolio).includes(ticker)) {
      buySignals.push({
        ticker,
        ...stock,
        signal
      });
    }
  }
  
  // Sort by priority and confidence
  buySignals.sort((a, b) => {
    if (a.signal.priority !== b.signal.priority) {
      return a.signal.priority - b.signal.priority;
    }
    return b.signal.confidence - a.signal.confidence;
  });
  
  const topBuySignals = buySignals.slice(0, 25);

  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trading Dashboard - Positions & Buy Signals</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f1419 0%, #1a1f26 100%);
      color: #e0e0e0;
      padding: 30px 20px;
      min-height: 100vh;
    }

    .container {
      max-width: 1600px;
      margin: 0 auto;
    }

    .header {
      margin-bottom: 30px;
    }

    h1 {
      font-size: 36px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 8px;
    }

    .timestamp {
      color: #888;
      font-size: 13px;
    }

    .section {
      margin-bottom: 40px;
    }

    .section-title {
      font-size: 22px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid rgba(77, 166, 255, 0.3);
    }

    .positions-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .position-card {
      background: rgba(26, 31, 38, 0.8);
      border: 1px solid rgba(68, 98, 122, 0.3);
      border-radius: 12px;
      padding: 20px;
      backdrop-filter: blur(10px);
    }

    .position-card .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 15px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(68, 98, 122, 0.2);
    }

    .ticker {
      font-size: 22px;
      font-weight: 700;
      color: #4da6ff;
    }

    .price {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
    }

    .gain {
      font-size: 20px;
      font-weight: 700;
      margin: 12px 0;
    }

    .gain.positive {
      color: #4ade80;
    }

    .gain.negative {
      color: #f87171;
    }

    .buy-signals-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }

    .signal-card {
      background: rgba(26, 31, 38, 0.8);
      border: 1px solid rgba(68, 98, 122, 0.3);
      border-radius: 10px;
      padding: 16px;
      backdrop-filter: blur(10px);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .signal-card:hover {
      border-color: rgba(77, 166, 255, 0.5);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .signal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .signal-ticker {
      font-size: 18px;
      font-weight: 700;
      color: #4da6ff;
    }

    .signal-type {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .signal-type.fresh {
      background: rgba(74, 222, 128, 0.2);
      color: #4ade80;
      border: 1px solid rgba(74, 222, 128, 0.4);
    }

    .signal-type.imminent {
      background: rgba(251, 191, 36, 0.2);
      color: #fbbf24;
      border: 1px solid rgba(251, 191, 36, 0.4);
    }

    .signal-type.early {
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
      border: 1px solid rgba(59, 130, 246, 0.4);
    }

    .signal-price {
      font-size: 16px;
      font-weight: 700;
      color: #e0e0e0;
      margin-bottom: 8px;
    }

    .signal-metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 10px;
      font-size: 11px;
    }

    .metric {
      background: rgba(15, 20, 25, 0.6);
      padding: 6px;
      border-radius: 4px;
    }

    .metric-label {
      color: #888;
      font-size: 10px;
    }

    .metric-value {
      color: #e0e0e0;
      font-weight: 600;
    }

    .confidence-bar {
      width: 100%;
      height: 4px;
      background: rgba(68, 98, 122, 0.2);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #4ade80, #fbbf24);
      width: 0%;
      transition: width 0.3s ease;
    }

    .summary {
      background: rgba(26, 31, 38, 0.8);
      border: 1px solid rgba(68, 98, 122, 0.3);
      border-radius: 12px;
      padding: 24px;
      margin-top: 30px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 16px;
    }

    .summary-item {
      text-align: center;
      padding: 12px;
      background: rgba(15, 20, 25, 0.6);
      border-radius: 6px;
    }

    .summary-label {
      font-size: 10px;
      color: #888;
      text-transform: uppercase;
    }

    .summary-value {
      font-size: 24px;
      font-weight: 700;
      margin-top: 6px;
      color: #fff;
    }

    .filter-controls {
      margin-bottom: 20px;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .filter-btn {
      padding: 8px 14px;
      background: rgba(77, 166, 255, 0.1);
      border: 1px solid rgba(77, 166, 255, 0.3);
      color: #4da6ff;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .filter-btn.active {
      background: rgba(77, 166, 255, 0.3);
      border-color: rgba(77, 166, 255, 0.8);
    }

    @media (max-width: 768px) {
      .buy-signals-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Trading Dashboard</h1>
      <div class="timestamp">Last updated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST</div>
    </div>

    <!-- HOLDINGS SECTION -->
    <div class="section">
      <div class="section-title">📈 Current Holdings (3)</div>
      <div class="positions-grid" id="positions"></div>
    </div>

    <!-- BUY SIGNALS SECTION -->
    <div class="section">
      <div class="section-title">🚀 Buy Signals (Top 25)</div>
      <div class="filter-controls" id="filters"></div>
      <div class="buy-signals-grid" id="signals"></div>
    </div>

    <!-- SUMMARY -->
    <div class="summary">
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">Holdings</div>
          <div class="summary-value">3</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Buy Signals</div>
          <div class="summary-value">${topBuySignals.length}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Fresh</div>
          <div class="summary-value">${topBuySignals.filter(s => s.signal.type === 'FRESH').length}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Imminent</div>
          <div class="summary-value">${topBuySignals.filter(s => s.signal.type === 'IMMINENT').length}</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const portfolio = ${JSON.stringify(portfolio)};
    const buySignals = ${JSON.stringify(topBuySignals)};
    let filteredSignals = [...buySignals];

    function renderPositions() {
      const container = document.getElementById('positions');
      Object.entries(portfolio).forEach(([ticker, config]) => {
        const current = Math.random() * 20 + 85; // Mock
        const gain = ((current - config.entry) / config.entry * 100).toFixed(2);
        const gainClass = gain >= 0 ? 'positive' : 'negative';

        const card = document.createElement('div');
        card.className = 'position-card';
        card.innerHTML = \`
          <div class="card-header">
            <span class="ticker">\${ticker}</span>
            <span class="price">$\${current.toFixed(2)}</span>
          </div>
          <div class="gain \${gainClass}">\${gain >= 0 ? '+' : ''}\${gain}%</div>
          <div style="font-size: 12px; color: #888;">Entry: $\${config.entry.toFixed(2)}</div>
        \`;
        container.appendChild(card);
      });
    }

    function renderSignals() {
      const container = document.getElementById('signals');
      container.innerHTML = '';
      filteredSignals.forEach(signal => {
        const card = document.createElement('div');
        card.className = 'signal-card';
        const typeClass = signal.signal.type.toLowerCase();
        
        card.innerHTML = \`
          <div class="signal-header">
            <span class="signal-ticker">\${signal.ticker}</span>
            <span class="signal-type \${typeClass}">\${signal.signal.type}</span>
          </div>
          <div class="signal-price">$\${signal.current.toFixed(2)}</div>
          <div class="confidence-bar">
            <div class="confidence-fill" style="width: \${signal.signal.confidence}%"></div>
          </div>
          <div class="signal-metrics">
            <div class="metric">
              <div class="metric-label">Gap</div>
              <div class="metric-value">\${signal.gapNum.toFixed(2)}%</div>
            </div>
            <div class="metric">
              <div class="metric-label">Vol Ratio</div>
              <div class="metric-value">\${signal.volRatioNum.toFixed(2)}x</div>
            </div>
            <div class="metric">
              <div class="metric-label">MA9</div>
              <div class="metric-value">\${signal.ma9.toFixed(0)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">MA27</div>
              <div class="metric-value">\${signal.ma27.toFixed(0)}</div>
            </div>
          </div>
          <div style="font-size: 11px; color: #888; text-align: center;">
            Confidence: \${signal.signal.confidence.toFixed(0)}%
          </div>
        \`;
        container.appendChild(card);
      });
    }

    function renderFilters() {
      const container = document.getElementById('filters');
      const types = ['FRESH', 'IMMINENT', 'EARLY', 'ESTABLISHED', 'ALL'];
      types.forEach(type => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn' + (type === 'ALL' ? ' active' : '');
        btn.textContent = type;
        btn.onclick = () => {
          document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (type === 'ALL') {
            filteredSignals = [...buySignals];
          } else {
            filteredSignals = buySignals.filter(s => s.signal.type === type);
          }
          renderSignals();
        };
        container.appendChild(btn);
      });
    }

    renderPositions();
    renderSignals();
    renderFilters();
  </script>
</body>
</html>`;

  const outputDir = '/Users/unicornrobot/.openclaw/workspace/tools/stock-dashboard';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  fs.writeFileSync(path.join(outputDir, 'index.html'), html);
  console.log('Enhanced dashboard generated:', path.join(outputDir, 'index.html'));
}

generateEnhancedDashboard().catch(console.error);
