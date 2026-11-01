import type { Metadata } from "next";
import AccountView from "./view";

export const metadata: Metadata = {
  title: "Account",
};

export default function AccountPage() {
  return <AccountView />;
}