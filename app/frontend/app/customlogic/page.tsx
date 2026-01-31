'use client';

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useState, useRef } from "react";

import idl from "@/idl/escrow_application.json";
import {
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  MINT_SIZE,
  createAssociatedTokenAccountInstruction,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token"

import {
  Keypair,
  SystemProgram,
  Transaction,
  PublicKey,
} from "@solana/web3.js";

export default function Customlogic() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  if (!wallet.connected && !connection) {
    return null;
  }

  let provider = new anchor.AnchorProvider(
    connection,
    wallet as any,
    { 
      preflightCommitment: "confirmed",
      commitment: "confirmed"
    }
  );
  
  let program = new Program(
    idl as anchor.Idl,
    provider
  );

  const runtimeescrowflow = async () => {
    // Prevent multiple simultaneous executions
    if (processingRef.current || isProcessing) {
      console.log("⚠️ Transaction already in progress, please wait...");
      return;
    }

    try {
      processingRef.current = true;
      setIsProcessing(true);

      if (!wallet.publicKey) {
        console.error("Wallet not connected");
        return;
      }

      console.log("🚀 Starting escrow flow...");

      // Generate unique escrow ID using timestamp + random component
      const escrowId = new BN(Date.now() + Math.floor(Math.random() * 10000));
      console.log("📋 Escrow ID:", escrowId.toString());

      // Generate keypairs for mints
      const maker_mint = Keypair.generate();
      const taker_mint = Keypair.generate();

      console.log("🔑 Maker Mint:", maker_mint.publicKey.toString());
      console.log("🔑 Taker Mint:", taker_mint.publicKey.toString());

      let rent_exemption = await getMinimumBalanceForRentExemptMint(connection);
      
      // Step 1: Create both mints
      console.log("⏳ Step 1/6: Creating mints...");
      let tx_create_mint = new Transaction();
      
      // Get fresh blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      tx_create_mint.recentBlockhash = blockhash;
      tx_create_mint.feePayer = wallet.publicKey;
      
      tx_create_mint.add(
        SystemProgram.createAccount({
          fromPubkey: wallet.publicKey,
          newAccountPubkey: maker_mint.publicKey,
          space: MINT_SIZE,
          lamports: rent_exemption,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          maker_mint.publicKey,
          6,
          wallet.publicKey,
          wallet.publicKey,
          TOKEN_PROGRAM_ID,
        ),
        SystemProgram.createAccount({
          fromPubkey: wallet.publicKey,
          newAccountPubkey: taker_mint.publicKey,
          space: MINT_SIZE,
          lamports: rent_exemption,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          taker_mint.publicKey,
          6,
          wallet.publicKey,
          wallet.publicKey,
          TOKEN_PROGRAM_ID,
        ),
      );

      const tx_sig = await wallet.sendTransaction(tx_create_mint, connection, {
        signers: [maker_mint, taker_mint],
        skipPreflight: false,
      });
      
      console.log("📝 Mint creation tx:", tx_sig);
      
      // Wait for confirmation with timeout
      const confirmation = await connection.confirmTransaction({
        signature: tx_sig,
        blockhash,
        lastValidBlockHeight
      }, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error(`Mint creation failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log("✅ Step 1/6: Mints created successfully!");

      // Step 2: Create ATAs and mint tokens
      console.log("⏳ Step 2/6: Creating token accounts and minting...");
      
      const maker_ata_maker_mint = await getAssociatedTokenAddress(
        maker_mint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      
      const maker_ata_taker_mint = await getAssociatedTokenAddress(
        taker_mint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );

      const taker_ata_taker_mint = await getAssociatedTokenAddress(
        taker_mint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      
      const taker_ata_maker_mint = await getAssociatedTokenAddress(
        maker_mint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );

      const tx_create_ata = new Transaction();
      const { blockhash: blockhash2, lastValidBlockHeight: lastValidBlockHeight2 } = await connection.getLatestBlockhash('confirmed');
      tx_create_ata.recentBlockhash = blockhash2;
      tx_create_ata.feePayer = wallet.publicKey;
      
      tx_create_ata.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          maker_ata_maker_mint,
          wallet.publicKey,
          maker_mint.publicKey,
          TOKEN_PROGRAM_ID,
        ),
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          maker_ata_taker_mint,
          wallet.publicKey,
          taker_mint.publicKey,
          TOKEN_PROGRAM_ID,
        ),
        createMintToInstruction(
          maker_mint.publicKey,
          maker_ata_maker_mint,
          wallet.publicKey,
          100_000,
          [],
          TOKEN_PROGRAM_ID
        ),
        createMintToInstruction(
          taker_mint.publicKey,
          taker_ata_taker_mint,
          wallet.publicKey,
          100_000,
          [],
          TOKEN_PROGRAM_ID
        ),
      );
      
      const tx_ata_sig = await wallet.sendTransaction(tx_create_ata, connection, {
        skipPreflight: false,
      });
      
      console.log("📝 ATA creation tx:", tx_ata_sig);
      
      await connection.confirmTransaction({
        signature: tx_ata_sig,
        blockhash: blockhash2,
        lastValidBlockHeight: lastValidBlockHeight2
      }, 'confirmed');
      
      console.log("✅ Step 2/6: Token accounts created and tokens minted!");

      // Step 3: Find escrow PDA
      console.log("⏳ Step 3/6: Initializing escrow...");
      
      const [escrowpda, escrowbump] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          wallet.publicKey.toBuffer(),
          maker_mint.publicKey.toBuffer(),
          escrowId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      console.log("📍 Escrow PDA:", escrowpda.toString());

      const escrow_maker_pda = await getAssociatedTokenAddress(
        maker_mint.publicKey,
        escrowpda,
        true,
        TOKEN_PROGRAM_ID
      );

      const escrow_taker_pda = await getAssociatedTokenAddress(
        taker_mint.publicKey,
        escrowpda,
        true,
        TOKEN_PROGRAM_ID
      );
    
      // Initialize escrow
      let tx_inizialse = await program.methods
        .inizialiseEscrow(
          escrowId,
          new BN(100),
          new BN(100)
        )
        .accounts({
          escrow: escrowpda,
          maker: wallet.publicKey,
          taker: wallet.publicKey,
          mintMaker: maker_mint.publicKey,
          mintTaker: taker_mint.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: false });
      
      await connection.confirmTransaction(tx_inizialse, 'confirmed');
      console.log("✅ Step 3/6: Escrow initialized!");

      // Step 4: Deposit maker tokens
      console.log("⏳ Step 4/6: Depositing maker tokens...");
      
      let tx_deposit_maker = await program.methods
        .depositMaker()
        .accounts({
          escrow: escrowpda,
          maker: wallet.publicKey,
          mintAta: maker_ata_maker_mint,
          escrowMakeAta: escrow_maker_pda,
          mintMaker: maker_mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: false });
      
      await connection.confirmTransaction(tx_deposit_maker, 'confirmed');
      console.log("✅ Step 4/6: Maker tokens deposited!");
    
      // Step 5: Deposit taker tokens
      console.log("⏳ Step 5/6: Depositing taker tokens...");
      
      let tx_deposit_taker = await program.methods
        .depositTaker()
        .accounts({
          escrow: escrowpda,
          taker: wallet.publicKey,
          mintTakerAta: taker_ata_taker_mint,
          escrowTakerAta: escrow_taker_pda,
          mintTaker: taker_mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: false });
      
      await connection.confirmTransaction(tx_deposit_taker, 'confirmed');
      console.log("✅ Step 5/6: Taker tokens deposited!");

      // Step 6: Execute swap
      console.log("⏳ Step 6/6: Executing swap...");
      
      let tx_execute = await program.methods
        .execute()
        .accounts({
          escrow: escrowpda,
          maker: wallet.publicKey,
          makeAta: maker_ata_taker_mint,
          takerAta: taker_ata_maker_mint,
          escrowMakerAta: escrow_maker_pda,
          escrowTakeAta: escrow_taker_pda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ skipPreflight: false });

      await connection.confirmTransaction(tx_execute, 'confirmed');
      console.log("✅ Step 6/6: Swap executed successfully!");

      // Verify final balances
      const finalMakerTakerBalance = await connection.getTokenAccountBalance(maker_ata_taker_mint);
      
      console.log("\n🎉 Escrow Flow Complete!");
      console.log("💰 Final Maker Balance (Taker Mint):", finalMakerTakerBalance.value.uiAmount);
      console.log("📋 Escrow ID:", escrowId.toString());
      
      alert("✅ Escrow completed successfully! Check console for details.");

    } catch (error: any) {
      console.error("❌ Error in escrow flow:", error);
      
      if (error.logs) {
        console.error("Transaction logs:", error.logs);
      }
      
      if (error.message) {
        console.error("Error message:", error.message);
      }
      
      alert(`❌ Transaction failed: ${error.message || 'Unknown error'}`);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }
    
  return (
    <div>
      <div style={{ padding: 24 }}>
        <h2>Escrow Application (Production Style)</h2>
        <button 
          onClick={runtimeescrowflow}
          disabled={!wallet.connected || isProcessing}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            backgroundColor: !wallet.connected || isProcessing ? '#ccc' : '#512da8',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: !wallet.connected || isProcessing ? 'not-allowed' : 'pointer',
            marginTop: '12px',
            opacity: isProcessing ? 0.7 : 1,
          }}
        >
          {isProcessing ? '⏳ Processing...' : (wallet.connected ? 'Run Escrow Flow' : 'Connect Wallet First')}
        </button>
        
        {!wallet.connected && (
          <p style={{ marginTop: '12px', color: '#666' }}>
            Please connect your wallet to run the escrow flow
          </p>
        )}
        
        {isProcessing && (
          <p style={{ marginTop: '12px', color: '#512da8', fontWeight: 'bold' }}>
            ⏳ Transaction in progress... Please wait and check console for details.
          </p>
        )}
      </div>
    </div>
  );
}