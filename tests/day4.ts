import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { EscrowApplication } from "../target/types/escrow_application";
import {createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo} from "@solana/spl-token";

describe("day4", () => {
  // Configure the client to use the local cluster.
  let provider=anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.EscrowApplication as Program<EscrowApplication>;
 
  let maker_mint:anchor.web3.PublicKey;
  let taker_mint:anchor.web3.PublicKey;
  let maker_ata:anchor.web3.PublicKey;
  let taker_ata:anchor.web3.PublicKey;

  let escrow_pda:anchor.web3.PublicKey;
  let escrow_bump:number;
  let escrow_make_pda:anchor.web3.PublicKey;
  let escrow_taker_pda:anchor.web3.PublicKey;
  let maker=provider.wallet as anchor.Wallet;
  let amount_maker;
  let amount_taker;


  before("it is from the before",async()=>{

    amount_maker=new anchor.BN(1000);
    amount_taker=new anchor.BN(100);
    
    
     maker_mint=await createMint(
      provider.connection,
      maker.payer,
      maker.publicKey,
      maker.publicKey,
      6,
    )
     taker_mint=await createMint(
      provider.connection,
      maker.payer,
      maker.publicKey,
      null,
      6
    )
    maker_ata=(await getOrCreateAssociatedTokenAccount(
      provider.connection,
      maker.payer,
      maker_mint,
      maker.publicKey,


        )
      ).address;
    
    taker_ata=(await getOrCreateAssociatedTokenAccount(
      provider.connection,
      maker.payer,
      taker_mint,
      maker.publicKey
    )).address;

    await mintTo(
      provider.connection,
      maker.payer,
      maker_mint,
      maker_ata,
      maker.payer,
      amount_maker.toNumber(),
    )
    await mintTo(
      provider.connection,
      maker.payer,
      taker_mint,
      taker_ata,
      maker.payer,
      amount_taker.toNumber(),
    )

      const [escrowPda, escrowBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        maker.publicKey.toBuffer(),
        maker_mint.toBuffer(),
      ],
      program.programId
    );
    escrow_pda = escrowPda;
    escrow_bump = escrowBump;
    console.log(escrow_bump);

    escrow_make_pda=await anchor.utils.token.associatedAddress(
      {
        mint:maker_mint,
        owner:escrow_pda,
      }
    );
    escrow_taker_pda=await anchor.utils.token.associatedAddress(
      {
        mint:taker_mint,
        owner:escrow_pda,
      }
    );

  });


  it("Is initialized!", async () => {
    // Add your test here.
    let tx=await program.methods.inizialiseEscrow(amount_maker,amount_taker).accounts({
      maker:maker.publicKey,
      taker:maker.publicKey,
      mintMaker:maker_mint,
      mintTaker:taker_mint,

    }).rpc();

    console.log("Your transaction signature"+tx);
  });
  it("it is from the deposit_maker",async()=>{
    let tx=await program.methods.depositMaker().accounts({
      escrow:escrow_pda,
      maker:maker.publicKey,
      mintAta:maker_ata,
      mintMaker:maker_mint,

    }).rpc();
    console.log("your transaction signature"+tx);

  });
  it("it is from the deopsit_taker",async()=>{
    let tx=program.methods.depositTaker().accounts({
      escrow:escrow_pda,
      taker:maker.publicKey,
      mintTakerAta:taker_ata,
      mintTaker:taker_mint,
    }).rpc();
    console.log("it is from the transaction"+tx);
  })

  it("it is excution",async()=>{
    let tx=program.methods.execute().accounts({
      maker:maker.publicKey,
      makeAta:maker_ata,
      takerAta:taker_ata,
      escrowMakerAta:escrow_make_pda,
      escrowTakeAta:escrow_taker_pda,
    }).rpc();
    console.log("it from the transaction exceute"+tx);
    let take_amount=await getAccount(
      provider.connection,
      taker_ata,
    );
    let maker_amount=await getAccount(
      provider.connection,
      maker_ata,
    )
    
    console.log("taker amount:"+take_amount.amount);
    console.log("maker token : "+maker_amount.amount);
  })
});
