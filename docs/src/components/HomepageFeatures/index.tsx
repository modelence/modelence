import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'What is Modelence?',
    Svg: require('@site/static/img/undraw_questions_g2px.svg').default,
    description: (
      <>
        Modelence is a full-stack JavaScript framework for building and deploying interactive and AI-powered applications.
        And Modelence Cloud is the platform built for hosting Modelence applications with zero custom setup.
      </>
    ),
  },
  {
    title: 'Who is this for?',
    Svg: require('@site/static/img/undraw_startup-life_7hl8.svg').default,
    description: (
      <>
        Built for startups and scaleups, by ex-startup founders. Modelence aims to solve all of your platform challenges so you can focus on your product.
      </>
    ),
  },
  {
    title: 'Main Features',
    Svg: require('@site/static/img/undraw_features-overview_uone.svg').default,
    description: (
      <>
        Integrated MongoDB hosting, built in user system with authentication, built in cron jobs, out of the box monitoring and observability
      </>
    ),
  },
];

function Feature({title, Svg, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
