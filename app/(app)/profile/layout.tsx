export default function ProfileLayout({ children }: LayoutProps<"/profile">) {
  return <div className="flex flex-col gap-6">{children}</div>;
}
