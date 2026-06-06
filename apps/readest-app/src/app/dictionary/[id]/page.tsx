import dynamic from 'next/dynamic';

const DictionaryDetailPage = dynamic(() => import('./DictionaryDetailPage'), {
  ssr: false,
});

export function generateStaticParams() {
  return [];
}

export default function Page() {
  return <DictionaryDetailPage />;
}
