'use client';

import { use, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import {
  REPORTING_FRAMEWORKS,
  formatAmount,
  type CompanySettings,
  type ReportingFramework,
} from '@finstat/shared';

import { api, ApiError } from '@/lib/api';
import { AppShell, companyNav } from '@/components/app-shell';
import { useCompany, useSettings, type CompanyDetail } from '@/lib/queries';
import { Alert, Button, Card, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

export default function SettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = use(params);
  const company = useCompany(companyId);
  const settings = useSettings(companyId);
  const queryClient = useQueryClient();

  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [details, setDetails] = useState<Partial<CompanyDetail>>({});
  const [display, setDisplay] = useState<Partial<CompanySettings>>({});

  // Fill the forms once the saved values arrive.
  useEffect(() => {
    if (company.data) setDetails(company.data);
  }, [company.data]);
  useEffect(() => {
    if (settings.data) setDisplay(settings.data);
  }, [settings.data]);

  function report(caught: unknown, fallback: string) {
    setMessage({ tone: 'bad', text: caught instanceof ApiError ? caught.message : fallback });
  }

  const saveDetails = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/companies/${companyId}`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['company', companyId] });
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      setMessage({ tone: 'good', text: 'Company details saved.' });
    },
    onError: (caught) => report(caught, 'Could not save the company details.'),
  });

  const saveDisplay = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<CompanySettings>(`/companies/${companyId}/settings`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings', companyId] });
      setMessage({ tone: 'good', text: 'Settings saved.' });
    },
    onError: (caught) => report(caught, 'Could not save those settings.'),
  });

  if (company.isLoading || settings.isLoading) {
    return (
      <AppShell nav={companyNav(companyId)} contextLabel={company.data?.name}>
        <Spinner />
      </AppShell>
    );
  }

  return (
    <AppShell
      nav={companyNav(companyId)}
      contextLabel={company.data?.name}
      contextHref={`/c/${companyId}`}
    >
      <PageHeader
        title="Settings"
        description="The details that appear on the cover of the statements, and how figures are drawn."
      />

      {message ? (
        <div className="mb-4">
          <Alert tone={message.tone} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Company" description="Printed on the cover page and in the footer.">
          <form
            className="space-y-3 px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveDetails.mutate({
                name: details.name,
                registrationNumber: details.registrationNumber ?? '',
                taxNumber: details.taxNumber ?? '',
                country: details.country ?? '',
                addressLine1: details.addressLine1 ?? '',
                city: details.city ?? '',
                postalCode: details.postalCode ?? '',
                reportingFramework: details.reportingFramework,
                preparedBy: details.preparedBy ?? '',
                approvedBy: details.approvedBy ?? '',
                reportFooter: details.reportFooter ?? '',
              });
            }}
          >
            <Input
              label="Name"
              value={details.name ?? ''}
              onChange={(e) => setDetails({ ...details, name: e.target.value })}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Registration number"
                value={details.registrationNumber ?? ''}
                onChange={(e) => setDetails({ ...details, registrationNumber: e.target.value })}
              />
              <Input
                label="Tax number"
                value={details.taxNumber ?? ''}
                onChange={(e) => setDetails({ ...details, taxNumber: e.target.value })}
              />
            </div>
            <Input
              label="Address"
              value={details.addressLine1 ?? ''}
              onChange={(e) => setDetails({ ...details, addressLine1: e.target.value })}
            />
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="City"
                value={details.city ?? ''}
                onChange={(e) => setDetails({ ...details, city: e.target.value })}
              />
              <Input
                label="Postal code"
                value={details.postalCode ?? ''}
                onChange={(e) => setDetails({ ...details, postalCode: e.target.value })}
              />
              <Input
                label="Country"
                value={details.country ?? ''}
                onChange={(e) => setDetails({ ...details, country: e.target.value })}
              />
            </div>
            <Select
              label="Reporting framework"
              value={details.reportingFramework ?? 'IFRS_FOR_SMES'}
              onChange={(e) =>
                setDetails({ ...details, reportingFramework: e.target.value as ReportingFramework })
              }
            >
              {REPORTING_FRAMEWORKS.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Prepared by"
                value={details.preparedBy ?? ''}
                onChange={(e) => setDetails({ ...details, preparedBy: e.target.value })}
              />
              <Input
                label="Approved by"
                value={details.approvedBy ?? ''}
                onChange={(e) => setDetails({ ...details, approvedBy: e.target.value })}
              />
            </div>
            <Textarea
              label="Report footer"
              rows={2}
              value={details.reportFooter ?? ''}
              onChange={(e) => setDetails({ ...details, reportFooter: e.target.value })}
            />

            <div className="flex justify-end pt-1">
              <Button type="submit" variant="primary" loading={saveDetails.isPending}>
                <Save className="h-4 w-4" />
                Save company
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Figures" description="How amounts are shown across the app and in reports.">
          <form
            className="space-y-3 px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveDisplay.mutate({
                currencyCode: display.currencyCode,
                currencySymbol: display.currencySymbol,
                locale: display.locale,
                decimals: display.decimals,
                negativeStyle: display.negativeStyle,
                showCents: display.showCents,
              });
            }}
          >
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Currency code"
                value={display.currencyCode ?? ''}
                onChange={(e) =>
                  setDisplay({ ...display, currencyCode: e.target.value.toUpperCase().slice(0, 3) })
                }
                maxLength={3}
              />
              <Input
                label="Symbol"
                value={display.currencySymbol ?? ''}
                onChange={(e) => setDisplay({ ...display, currencySymbol: e.target.value })}
                maxLength={5}
              />
              <Input
                label="Locale"
                value={display.locale ?? ''}
                onChange={(e) => setDisplay({ ...display, locale: e.target.value })}
                hint="en-US, en-GB, de-DE"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Negative amounts"
                value={display.negativeStyle ?? 'PARENTHESES'}
                onChange={(e) =>
                  setDisplay({
                    ...display,
                    negativeStyle: e.target.value as CompanySettings['negativeStyle'],
                  })
                }
              >
                <option value="PARENTHESES">In brackets, like (1,234.00)</option>
                <option value="MINUS">With a minus, like -1,234.00</option>
              </Select>
              <Select
                label="Decimal places"
                value={String(display.decimals ?? 2)}
                onChange={(e) => setDisplay({ ...display, decimals: Number(e.target.value) })}
              >
                {[0, 1, 2, 3, 4].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>

            <div className="rounded-md bg-ink-50 px-3 py-2.5 text-sm">
              <div className="text-xs font-medium text-ink-500">Preview</div>
              <div className="tabular mt-1 flex gap-6">
                <span>{formatAmount(1234567.89, { decimals: display.decimals ?? 2 })}</span>
                <span className="text-red-600">
                  {formatAmount(-1234.5, {
                    accounting: (display.negativeStyle ?? 'PARENTHESES') === 'PARENTHESES',
                    decimals: display.decimals ?? 2,
                  })}
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" variant="primary" loading={saveDisplay.isPending}>
                <Save className="h-4 w-4" />
                Save settings
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
