import { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

interface PageLayoutProps {
  header: PageHeaderProps;
  children: ReactNode;
  className?: string;
}

interface SectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center space-x-2">{actions}</div>}
    </div>
  );
}

export function PageLayout({ header, children, className = '' }: PageLayoutProps) {
  return (
    <div className={`space-y-6 p-6 ${className}`}>
      <PageHeader {...header} />
      {children}
    </div>
  );
}

export function Section({ title, description, children, actions, className = '' }: SectionProps) {
  if (!title) {
    return <div className={className}>{children}</div>;
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {actions && <div className="flex items-center space-x-2">{actions}</div>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
