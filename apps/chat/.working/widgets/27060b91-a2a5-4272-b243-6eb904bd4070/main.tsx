import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calculator, Plus, Equal } from 'lucide-react';

interface MathWidgetProps {
  initialA?: number;
  initialB?: number;
  operation?: '+' | '-' | '*' | '/';
}

export default function MathWidget({ 
  initialA = 2, 
  initialB = 2, 
  operation = '+' 
}: MathWidgetProps) {
  const [numA, setNumA] = useState(initialA);
  const [numB, setNumB] = useState(initialB);
  const [op, setOp] = useState(operation);

  const calculate = () => {
    switch (op) {
      case '+': return numA + numB;
      case '-': return numA - numB;
      case '*': return numA * numB;
      case '/': return numB !== 0 ? numA / numB : 'Error';
      default: return 0;
    }
  };

  const result = calculate();

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Math Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Visual equation display */}
        <div className="bg-slate-50 rounded-lg p-4 text-center">
          <div className="flex items-center justify-center gap-3 text-2xl font-mono">
            <span className="bg-white px-3 py-2 rounded border font-bold text-blue-600">
              {numA}
            </span>
            <span className="text-gray-600">{op}</span>
            <span className="bg-white px-3 py-2 rounded border font-bold text-blue-600">
              {numB}
            </span>
            <Equal className="h-5 w-5 text-gray-600" />
            <span className="bg-green-100 text-green-800 px-4 py-2 rounded border-2 border-green-300 font-bold text-xl">
              {result}
            </span>
          </div>
        </div>

        {/* Interactive controls */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-600">First Number</label>
            <input
              type="number"
              value={numA}
              onChange={(e) => setNumA(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-600">Second Number</label>
            <input
              type="number"
              value={numB}
              onChange={(e) => setNumB(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Operation buttons */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-600">Operation</label>
          <div className="flex gap-2">
            {['+', '-', '*', '/'].map((operation) => (
              <Button
                key={operation}
                variant={op === operation ? 'default' : 'outline'}
                size="sm"
                onClick={() => setOp(operation as '+' | '-' | '*' | '/')}
                className="flex-1"
              >
                {operation}
              </Button>
            ))}
          </div>
        </div>

        {/* Result highlight */}
        <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-600 mb-1">Answer</p>
          <p className="text-3xl font-bold text-blue-800">{result}</p>
        </div>
      </CardContent>
    </Card>
  );
}
