use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer, Mint, TokenAccount, Token};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("6YVxaXeFLifNp3Di9yjzKJVqr6DwgtQyuJCn32oP3A73");

#[program]
pub mod escrow_application {
    use super::*;

    pub fn inizialise_escrow(
        ctx: Context<Inizialise>,
        escrow_id: u64,
        amount_maker: u64,
        amount_taker: u64
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.maker = ctx.accounts.maker.key();
        escrow.taker = ctx.accounts.taker.key();
        escrow.mint_maker = ctx.accounts.mint_maker.key();
        escrow.mint_taker = ctx.accounts.mint_taker.key();
        escrow.amount_maker = amount_maker;
        escrow.amount_taker = amount_taker;
        escrow.deposit_maker = false;
        escrow.deposit_taker = false;
        escrow.bump = ctx.bumps.escrow;
        escrow.escrow_id = escrow_id;
        Ok(())
    }

    pub fn deposit_maker(ctx: Context<Depositmaker>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        
        let cpi_context = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.mint_ata.to_account_info(),
                to: ctx.accounts.escrow_make_ata.to_account_info(),
                authority: ctx.accounts.maker.to_account_info(),
            },
        );
        
        token::transfer(cpi_context, escrow.amount_maker)?;
        escrow.deposit_maker = true;

        Ok(())
    }

    pub fn deposit_taker(ctx: Context<Deposittaker>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        
        let cpi_context = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.mint_taker_ata.to_account_info(),
                to: ctx.accounts.escrow_taker_ata.to_account_info(),
                authority: ctx.accounts.taker.to_account_info(),
            }
        );
        
        token::transfer(cpi_context, escrow.amount_taker)?;
        escrow.deposit_taker = true;
        
        Ok(())
    }

    pub fn execute(ctx: Context<Execute>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        
        require!(
            escrow.deposit_maker && escrow.deposit_taker,
            Errorescrow::EscrowNotReady
        );
        
        let seeds = &[
            b"escrow",
            escrow.maker.as_ref(),
            escrow.mint_maker.as_ref(),
            &escrow.escrow_id.to_le_bytes(),
            &[escrow.bump],
        ];
        let signer = &[&seeds[..]];
        
        // Transfer maker tokens to taker
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_maker_ata.to_account_info(),
                    to: ctx.accounts.taker_ata.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer
            ),
            escrow.amount_maker,
        )?;
        
        // Transfer taker tokens to maker
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_take_ata.to_account_info(),
                    to: ctx.accounts.make_ata.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer
            ),
            escrow.amount_taker,
        )?;

        // Close escrow maker token account
        token::close_account(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::CloseAccount {
                    account: ctx.accounts.escrow_maker_ata.to_account_info(),
                    destination: ctx.accounts.maker.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer,
            ),
        )?;

        msg!("Closed escrow_maker_ata");

        // Close escrow taker token account
        token::close_account(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::CloseAccount {
                    account: ctx.accounts.escrow_take_ata.to_account_info(),
                    destination: ctx.accounts.maker.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer,
            ),
        )?;
        
        msg!("Closed escrow_taker_ata");

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub mint_maker: Pubkey,
    pub mint_taker: Pubkey,
    pub amount_maker: u64,
    pub amount_taker: u64,
    pub deposit_maker: bool,
    pub deposit_taker: bool,
    pub bump: u8,
    pub escrow_id: u64,
}

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct Inizialise<'info> {
    #[account(
        init,
        payer = maker,
        seeds = [
            b"escrow",
            maker.key().as_ref(),
            mint_maker.key().as_ref(),
            escrow_id.to_le_bytes().as_ref()
        ],
        bump,
        space = 8 + Escrow::INIT_SPACE
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub maker: Signer<'info>,

    pub taker: SystemAccount<'info>,
    pub mint_maker: Account<'info, Mint>,
    pub mint_taker: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Depositmaker<'info> {
    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.maker.as_ref(),
            escrow.mint_maker.as_ref(),
            escrow.escrow_id.to_le_bytes().as_ref()
        ],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    
    #[account(mut)]
    pub maker: Signer<'info>,
    
    #[account(
        mut,
        constraint = mint_ata.owner == maker.key(),
        constraint = mint_ata.mint == mint_maker.key()
    )]
    pub mint_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = maker,
        associated_token::mint = mint_maker,
        associated_token::authority = escrow,
    )]
    pub escrow_make_ata: Account<'info, TokenAccount>,
    
    pub mint_maker: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposittaker<'info> {
    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.maker.as_ref(),
            escrow.mint_maker.as_ref(),
            escrow.escrow_id.to_le_bytes().as_ref()
        ],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub taker: Signer<'info>,
    
    #[account(
        mut,
        constraint = mint_taker_ata.owner == taker.key(),
        constraint = mint_taker_ata.mint == mint_taker.key()
    )]
    pub mint_taker_ata: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_taker,
        associated_token::authority = escrow,
    )]
    pub escrow_taker_ata: Account<'info, TokenAccount>,
    
    pub mint_taker: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.maker.as_ref(),
            escrow.mint_maker.as_ref(),
            escrow.escrow_id.to_le_bytes().as_ref()
        ],
        bump = escrow.bump,
        close = maker
    )]
    pub escrow: Account<'info, Escrow>,
    
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(mut)]
    pub make_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub taker_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub escrow_maker_ata: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub escrow_take_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum Errorescrow {
    #[msg("Tokens are already deposited")]
    AlreadyDeposited,
    #[msg("Escrow not ready")]
    EscrowNotReady,
}