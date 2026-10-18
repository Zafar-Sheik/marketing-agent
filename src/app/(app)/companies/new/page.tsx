import { NewCompanyForm } from './form';

export const metadata = { title: 'New client' };

export default function NewCompany() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New client</h1>
        <p className="text-sm text-muted">Tell the agents who this brand is. Next you’ll add past work, connect TikTok and start training.</p>
      </div>
      <NewCompanyForm />
    </div>
  );
}
