import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { NextPage } from 'next'
import styles from '../styles/Home.module.css'

import {
  convertViemChainToRelayChain,
  createClient,
  MAINNET_RELAY_API,
  TESTNET_RELAY_API,
} from '@reservoir0x/relay-sdk'
import { useAccount, useWalletClient } from 'wagmi'
import { baseSepolia, sepolia, zora } from 'viem/chains'
import { createPublicClient, http } from 'viem'
import { wagmiContract } from '../contract'

const relayClient = createClient({
  baseApiUrl: TESTNET_RELAY_API,
  source: 'YOUR.SOURCE',
  chains: [
    convertViemChainToRelayChain(baseSepolia),
    convertViemChainToRelayChain(sepolia),
  ],
})

const publicClient = createPublicClient({
  chain: zora,
  transport: http(),
})

const Home: NextPage = () => {
  const { address } = useAccount()

  console.log(relayClient)

  const { data: wallet } = useWalletClient()

  const mintWithBaseSepolia = async () => {
    if (!wallet || !address) {
      return
    }
    try {
      const { request } = await publicClient.simulateContract({
        ...wagmiContract,
        functionName: 'safeMint', // could be any contract method
        account: address,
        args: [address],
      })

      relayClient.actions.call({
        chainId: 84532, // base sepolia
        toChainId: 11155111, // sepolia
        txs: [
          // request, // mint
          {
            // bridge
            to: address,
            value: '123400000',
            data: '0x',
          },
        ],
        wallet,
        onProgress: (steps) => {
          // handle steps
        },
      })
    } catch (e) {
      throw e
    }
  }
  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <ConnectButton />
        <button onClick={mintWithBaseSepolia}>Mint with Base Sepolia</button>
      </main>
    </div>
  )
}

export default Home
