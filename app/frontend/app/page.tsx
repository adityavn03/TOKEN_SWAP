'use client'
import dynamic from "next/dynamic"
export default function App(){
  const WalletValue=dynamic(()=>import("./wallethandler/page"),{
    ssr:false,
  })

  return( 
   <div>
    <WalletValue/>
  </div>
  )
}