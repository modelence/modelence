import { notFound } from 'next/navigation'
import { importPage } from 'nextra/pages'

export const dynamic = 'force-static'

type PageProps = {
  params: Promise<{
    mdxPath?: string[]
  }>
}

export async function generateStaticParams() {
  return []
}

export async function generateMetadata(props: PageProps) {
  const params = await props.params
  const pathSegments = params.mdxPath || []
  
  try {
    const page = await importPage(pathSegments)
    return page.metadata || {}
  } catch {
    return {}
  }
}

export default async function Page(props: PageProps) {
  const params = await props.params
  const pathSegments = params.mdxPath || []
  
  try {
    const page = await importPage(pathSegments)
    const Component = page.default
    return <Component />
  } catch (error) {
    notFound()
  }
}
