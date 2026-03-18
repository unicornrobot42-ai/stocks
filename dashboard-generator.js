#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// Fetch stock data
function fetchStockData(ticker) {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v7/finance/download/${ticker}?period1=1746230400&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=history`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const lines = data.split('\n').filter(l => l.trim() && !l.startsWith('Date'));
          const prices = lines.slice(0, 90).reverse().map(l => {
            const parts = l.split(',');
            return parseFloat(parts[4]); // Close price
          });
          
          if (prices.length < 27) {
            resolve(null);
            return;
          }
          
          const ma9 = prices.slice(0, 9).reduce((a, b) => a + b) / 9;
          const ma27 = prices.slice(0, 27).reduce((a, b) => a + b) / 27;
          const current = prices[0];
          const vol20 = data.split('\n').slice(1, 21).map(l => parseInt(l.split(',')[6]) || 0).reduce((a, b) => a + b) / 20;
          const currentVol = parseInt(data.split('\n')[1].split(',')[6]) || 0;
          
          resolve({
            ticker,
            current,
            ma9,
            ma27,
            gap: ((ma9 - ma27) / ma27 * 100).toFixed(2),
            volume: currentVol,
            volRatio: (currentVol / vol20).toFixed(2)
          });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Calculate position status
function getPositionStatus(stock, entry, entryDate, exitTargets) {
  const now = new Date();
  const daysHeld = Math.floor((now - new Date(entryDate)) / (1000 * 60 * 60 * 24));
  const gain = ((stock.current - entry) / entry * 100).toFixed(2);
  
  let sellSignal = '🟢 HOLD';
  let action = '';
  
  // Stop loss
  if (stock.current <= entry * 0.92) {
    sellSignal = '🔴 STOP LOSS HIT';
    action = 'EXIT ALL (-8%)';
  }
  // MA9 below MA27
  else if (stock.gap < 0) {
    sellSignal = '🔴 TREND BREAK';
    action = 'EXIT ALL (MA9 < MA27)';
  }
  // Max hold
  else if (daysHeld >= 30) {
    sellSignal = '🟠 MAX HOLD (30 DAYS)';
    action = 'EXIT ALL';
  }
  // +20% target
  else if (daysHeld >= 24 && gain >= 20) {
    sellSignal = '🎯 +20% TARGET HIT';
    action = 'SELL final 20%';
  }
  // +10% target (sweet spot)
  else if (daysHeld >= 10 && gain >= 10) {
    sellSignal = '⭐ +10% TARGET HIT';
    action = 'SELL 30% (SWEET SPOT)';
  }
  // +5% target
  else if (daysHeld >= 7 && gain >= 5) {
    sellSignal = '🟡 +5% TARGET HIT';
    action = 'SELL 50%';
  }
  // Approaching targets
  else if (daysHeld >= 20 && gain >= 15) {
    sellSignal = '🟡 NEAR +20%';
    action = 'Watch for exit';
  }
  else if (daysHeld >= 8 && gain >= 9) {
    sellSignal = '🟡 NEAR +10%';
    action = 'Watch for exit';
  }
  
  return { daysHeld, gain, sellSignal, action };
}

// Generate dashboard HTML
async function generateDashboard() {
  const portfolio = {
    'NFLX': { entry: 97.09, entryDate: '2026-03-03', target5: 102, target10: 107, target20: 116, stopLoss: 89.30 },
    'GD': { entry: 364.78, entryDate: '2026-03-03', target5: 383, target10: 401, target20: 437, stopLoss: 335.60 },
    'MRVL': { entry: 80.86, entryDate: '2026-03-03', target5: 85, target10: 89, target20: 97, stopLoss: 74.40 }
  };
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trading Dashboard - ${new Date().toLocaleDateString()}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1419;
      color: #e0e0e0;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { margin-bottom: 10px; font-size: 28px; color: #fff; }
    .timestamp { color: #888; font-size: 12px; margin-bottom: 20px; }
    .portfolio { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card {
      background: #1a1f26;
      border: 1px solid #2a3038;
      border-radius: 8px;
      padding: 20px;
    }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #2a3038; padding-bottom: 10px; }
    .ticker { font-size: 20px; font-weight: bold; color: #4da6ff; }
    .price { font-size: 24px; font-weight: bold; }
    .gain { font-size: 18px; font-weight: bold; margin: 10px 0; }
    .gain.positive { color: #4ade80; }
    .gain.negative { color: #f87171; }
    .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 15px 0; font-size: 13px; }
    .metric { background: #0f1419; padding: 10px; border-radius: 4px; }
    .metric-label { color: #888; font-size: 11px; }
    .metric-value { font-weight: bold; color: #e0e0e0; }
    .sell-signal {
      font-size: 16px;
      font-weight: bold;
      padding: 12px;
      margin: 15px 0;
      border-radius: 4px;
      background: #1a2328;
      border-left: 3px solid #4ade80;
    }
    .sell-signal.alert { border-left-color: #f87171; background: #2a1a1a; }
    .action {
      font-size: 14px;
      background: #0f1419;
      padding: 10px;
      border-radius: 4px;
      color: #fbbf24;
      font-weight: bold;
    }
    .targets {
      margin: 15px 0;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .target { background: #0f1419; padding: 8px; border-radius: 4px; }
    .target.hit { background: #1a3a2a; color: #4ade80; }
    .summary { background: #1a1f26; border: 1px solid #2a3038; border-radius: 8px; padding: 20px; }
    .summary h2 { margin-bottom: 15px; color: #fff; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; }
    .summary-item { text-align: center; padding: 15px; background: #0f1419; border-radius: 4px; }
    .summary-label { color: #888; font-size: 12px; }
    .summary-value { font-size: 24px; font-weight: bold; margin-top: 8px; }
    .positive { color: #4ade80; }
    .negative { color: #f87171; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Trading Dashboard</h1>
    <div class="timestamp">Last updated: ${new Date().toLocaleString()} PST</div>
    
    <div class="portfolio">`;
  
  let totalGain = 0;
  let sellCount = 0;
  let positionCount = 0;
  
  for (const [ticker, config] of Object.entries(portfolio)) {
    try {
      const stock = await fetchStockData(ticker);
      if (!stock) continue;
      
      positionCount++;
      const status = getPositionStatus(stock, config.entry, config.entryDate, {
        target5: config.target5,
        target10: config.target10,
        target20: config.target20
      });
      
      const gain = parseFloat(status.gain);
      totalGain += gain;
      if (status.action.includes('SELL') || status.action.includes('EXIT')) sellCount++;
      
      const gainClass = gain >= 0 ? 'positive' : 'negative';
      const signalClass = status.sellSignal.includes('HOLD') ? '' : 'alert';
      
      html += `
      <div class="card">
        <div class="card-header">
          <span class="ticker">${ticker}</span>
          <span class="price">$${stock.current.toFixed(2)}</span>
        </div>
        
        <div class="gain ${gainClass}">
          ${gain >= 0 ? '+' : ''}${gain.toFixed(2)}% (${status.daysHeld} days)
        </div>
        
        <div class="metrics">
          <div class="metric">
            <div class="metric-label">Entry</div>
            <div class="metric-value">$${config.entry.toFixed(2)}</div>
          </div>
          <div class="metric">
            <div class="metric-label">MA9 vs MA27</div>
            <div class="metric-value">${stock.gap > 0 ? '+' : ''}${stock.gap}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Volume Ratio</div>
            <div class="metric-value">${stock.volRatio}x</div>
          </div>
          <div class="metric">
            <div class="metric-label">Stop Loss</div>
            <div class="metric-value">$${config.stopLoss.toFixed(2)}</div>
          </div>
        </div>
        
        <div class="sell-signal ${signalClass}">${status.sellSignal}</div>
        ${status.action ? `<div class="action">→ ${status.action}</div>` : ''}
        
        <div class="targets">
          <div class="target">+5% Target: $${config.target5.toFixed(2)} ${gain >= 5 ? '✓ HIT' : ''}</div>
          <div class="target">+10% Target: $${config.target10.toFixed(2)} ${gain >= 10 ? '✓ HIT' : ''}</div>
          <div class="target">+20% Target: $${config.target20.toFixed(2)} ${gain >= 20 ? '✓ HIT' : ''}</div>
        </div>
      </div>`;
    } catch (e) {
      console.error(`Error fetching ${ticker}:`, e.message);
    }
  }
  
  html += `
    </div>
    
    <div class="summary">
      <h2>Portfolio Summary</h2>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">Total Positions</div>
          <div class="summary-value">${positionCount}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Avg Gain</div>
          <div class="summary-value ${totalGain >= 0 ? 'positive' : 'negative'}">
            ${totalGain >= 0 ? '+' : ''}${(totalGain / (positionCount || 1)).toFixed(2)}%
          </div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Sell Signals</div>
          <div class="summary-value ${sellCount > 0 ? 'negative' : 'positive'}">${sellCount}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Status</div>
          <div class="summary-value">${sellCount === 0 ? '🟢 HOLDING' : '⚠️ ACTION NEEDED'}</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
  
  const outputDir = '/Users/unicornrobot/.openclaw/workspace/tools/stock-dashboard';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  fs.writeFileSync(path.join(outputDir, 'index.html'), html);
  console.log('Dashboard generated:', path.join(outputDir, 'index.html'));
}

generateDashboard().catch(console.error);
