import "./globals.css";
import type {Metadata} from "next";
export const metadata:Metadata={title:"Company Accounts · LedgerDesk",description:"Company accounts, documents and daily financial operations."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}

