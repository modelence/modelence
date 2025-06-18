import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Banner, Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
 
export const metadata = {
  title: {
    default: 'Modelence Documentation',
    template: '%s | Modelence Docs'
  },
  description: 'Modelence Docs - AI-native Backend for TypeScript'
}
 
const banner = <Banner storageKey="modelence-docs">Welcome to Modelence Documentation! 🚀</Banner>
const navbar = (
  <Navbar
    logo={<strong>Modelence</strong>}
    projectLink="https://github.com/modelence/modelence"
  />
)
const footer = <Footer>{new Date().getFullYear()} © Modelence.</Footer>
 
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      // Not required, but good for SEO
      lang="en"
      // Required to be set
      dir="ltr"
      // Suggested by `next-themes` package https://github.com/pacocoursey/next-themes#with-app
      suppressHydrationWarning
    >
      <Head
      // ... Your additional head options
      >
        {/* Your additional tags should be passed as `children` of `<Head>` element */}
      </Head>
      <body>
        <Layout
          banner={banner}
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/modelence/modelence/tree/main/docs"
          editLink="Edit this page on GitHub"
          sidebar={{
            defaultMenuCollapseLevel: 1,
            toggleButton: true
          }}
          footer={footer}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
