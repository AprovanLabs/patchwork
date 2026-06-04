import type { VirtualFile } from "@aprovan/patchwork-compiler";

const DASHBOARD_MAIN = `import { useState, useEffect } from 'react';
import { PriceCard } from './price-card';
import { StatusPanel } from './status-panel';
import { ActionBar } from './action-bar';

export default function LiveDashboard() {
  const [prices, setPrices] = useState<Record<string, { price: number; change: number }>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  useEffect(() => {
    const unsub1 = window.patchwork.subscribe('price_feed', (data: any, seq: number) => {
      setPrices(prev => ({ ...prev, ...data }));
      setLastUpdate(Date.now());
    });

    const unsub2 = window.patchwork.subscribe('system_status', (data: any, seq: number) => {
      setStatuses(prev => ({ ...prev, ...data }));
      setLastUpdate(Date.now());
    });

    return () => { unsub1(); unsub2(); };
  }, []);

  const handleRefresh = () => {
    window.patchwork.fireEvent('push_update', {
      stream: 'price_feed',
      data: { tick: true },
    });
  };

  const handleContextUpdate = () => {
    const summary = Object.entries(prices)
      .map(([sym, p]) => \`\${sym}: $\${p.price.toFixed(2)} (\${p.change >= 0 ? '+' : ''}\${p.change.toFixed(2)}%)\`)
      .join('; ');
    window.patchwork.updateContext(\`Dashboard state: \${summary}\`);
  };

  const priceEntries = Object.entries(prices);
  const statusEntries = Object.entries(statuses);

  return (
    <div className="p-6 max-w-2xl mx-auto bg-white rounded-xl shadow-lg space-y-6">
      <div className="flex items-center justify-between border-b pb-3">
        <h1 className="text-xl font-bold text-gray-900">Live Data Dashboard</h1>
        <span className="text-xs text-gray-400">
          Updated {new Date(lastUpdate).toLocaleTimeString()}
        </span>
      </div>

      {priceEntries.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
            Price Feed
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {priceEntries.map(([symbol, p]) => (
              <PriceCard key={symbol} symbol={symbol} price={p.price} change={p.change} />
            ))}
          </div>
        </section>
      )}

      {statusEntries.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
            System Status
          </h2>
          <StatusPanel statuses={statuses} />
        </section>
      )}

      <ActionBar onRefresh={handleRefresh} onContextUpdate={handleContextUpdate} />

      {priceEntries.length === 0 && statusEntries.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <p>Waiting for live data...</p>
          <p className="text-xs mt-1">Use push_update or subscribe to streams to see data here.</p>
        </div>
      )}
    </div>
  );
}
`;

const PRICE_CARD = `export function PriceCard({ symbol, price, change }: { symbol: string; price: number; change: number }) {
  const isPositive = change >= 0;
  return (
    <div className="p-3 rounded-lg border bg-gray-50">
      <div className="text-xs font-medium text-gray-500 uppercase">{symbol}</div>
      <div className="text-lg font-bold text-gray-900">\${price.toFixed(2)}</div>
      <div className={\`text-sm font-medium \${isPositive ? 'text-green-600' : 'text-red-600'}\`}>
        {isPositive ? '+' : ''}{change.toFixed(2)}%
      </div>
    </div>
  );
}
`;

const STATUS_PANEL = `export function StatusPanel({ statuses }: { statuses: Record<string, string> }) {
  const colorMap: Record<string, string> = {
    ok: 'bg-green-100 text-green-800',
    healthy: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    degraded: 'bg-yellow-100 text-yellow-800',
    error: 'bg-red-100 text-red-800',
    down: 'bg-red-100 text-red-800',
  };

  return (
    <div className="space-y-2">
      {Object.entries(statuses).map(([service, status]) => {
        const color = colorMap[status.toLowerCase()] ?? 'bg-gray-100 text-gray-800';
        return (
          <div key={service} className="flex items-center justify-between p-2 rounded border bg-gray-50">
            <span className="text-sm font-medium text-gray-700">{service}</span>
            <span className={\`text-xs font-semibold px-2 py-0.5 rounded \${color}\`}>{status}</span>
          </div>
        );
      })}
    </div>
  );
}
`;

const ACTION_BAR = `export function ActionBar({ onRefresh, onContextUpdate }: { onRefresh: () => void; onContextUpdate: () => void }) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        onClick={onRefresh}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
      >
        Refresh Data
      </button>
      <button
        onClick={onContextUpdate}
        className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
      >
        Send Context
      </button>
    </div>
  );
}
`;

export const REFERENCE_WIDGET_FILES: VirtualFile[] = [
  { path: "main.tsx", content: DASHBOARD_MAIN },
  { path: "price-card.tsx", content: PRICE_CARD },
  { path: "status-panel.tsx", content: STATUS_PANEL },
  { path: "action-bar.tsx", content: ACTION_BAR },
];

export const REFERENCE_WIDGET_MANIFEST = {
  name: "live-dashboard",
  version: "0.1.0",
  platform: "browser" as const,
  image: "@aprovan/patchwork-image-shadcn",
  description: "Live data dashboard with price feed, system status, and context feedback",
  services: ["weather"],
};
