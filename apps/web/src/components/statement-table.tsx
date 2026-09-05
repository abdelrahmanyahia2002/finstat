'use client';

import clsx from 'clsx';
import { formatAmount, type RenderedStatement, type StatementLine } from '@finstat/shared';

/**
 * One statement, laid out the way it prints.
 *
 * Headings, subtotals and totals each carry their own rule and weight, because
 * on a financial statement the typography is what tells a reader which figures
 * add up to which.
 */
export function StatementTable({ statement }: { statement: RenderedStatement }) {
  const showPrior = statement.priorLabel !== null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-200 text-xs text-ink-500">
            <th className="px-5 py-2 text-left font-medium" />
            <th className="w-14 px-2 py-2 text-center font-medium">Note</th>
            <th className="w-32 px-4 py-2 text-right font-medium">{statement.currentLabel}</th>
            {showPrior ? (
              <th className="w-32 px-5 py-2 text-right font-medium">{statement.priorLabel}</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {statement.lines.map((line) => (
            <StatementRow key={line.key} line={line} showPrior={showPrior} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatementRow({ line, showPrior }: { line: StatementLine; showPrior: boolean }) {
  if (line.style === 'SPACER') {
    return (
      <tr>
        <td className="h-3" colSpan={showPrior ? 4 : 3} />
      </tr>
    );
  }

  const bold = line.style === 'HEADING' || line.style === 'SUBTOTAL' || line.style === 'TOTAL';

  return (
    <tr
      className={clsx(
        line.style === 'SUBTOTAL' && 'border-t border-ink-200',
        line.style === 'TOTAL' && 'border-t-2 border-b-4 border-double border-ink-400',
      )}
    >
      <td
        className={clsx(
          'px-5 py-1.5',
          bold ? 'font-semibold text-ink-900' : 'text-ink-700',
          line.style === 'DETAIL' && 'text-xs text-ink-500',
        )}
        style={{ paddingLeft: `${20 + line.indent * 16}px` }}
      >
        {line.label}
      </td>
      <td className="px-2 py-1.5 text-center text-xs text-ink-400">{line.noteNumber ?? ''}</td>
      <td
        className={clsx(
          'tabular px-4 py-1.5 text-right',
          bold && 'font-semibold',
          (line.current ?? 0) < 0 && 'text-red-600',
        )}
      >
        {line.current === null ? '' : formatAmount(line.current)}
      </td>
      {showPrior ? (
        <td
          className={clsx(
            'tabular px-5 py-1.5 text-right text-ink-500',
            bold && 'font-semibold',
            (line.prior ?? 0) < 0 && 'text-red-600',
          )}
        >
          {line.prior === null ? '' : formatAmount(line.prior)}
        </td>
      ) : null}
    </tr>
  );
}
