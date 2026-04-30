import { lazy, Suspense, type ComponentType } from "react";

interface DynamicOptions {
  loading?: () => JSX.Element | null;
  ssr?: boolean;
}

export default function dynamic<TProps extends object>(
  loader: () => Promise<ComponentType<TProps> | { default: ComponentType<TProps> }>,
  options: DynamicOptions = {},
) {
  const LazyComponent = lazy(async () => {
    const module = await loader();
    return { default: (module as { default?: ComponentType<TProps> }).default ?? (module as ComponentType<TProps>) };
  }) as unknown as ComponentType<TProps>;

  return function DynamicComponent(props: TProps) {
    return (
      <Suspense fallback={options.loading?.() ?? null}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}