import { useCallback, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { NextPage } from 'next'
import {
  convertViemChainToRelayChain,
  createClient,
  Execute,
  TESTNET_RELAY_API,
} from '@reservoir0x/relay-sdk'
import {
  useAccount,
  useBalance,
  useConfig,
  useReadContract,
  useWalletClient,
  useWatchBlocks,
} from 'wagmi'
import { baseSepolia, sepolia } from 'viem/chains'
import { Address, createPublicClient, formatUnits, http } from 'viem'
import { getBalance, readContract, switchChain } from 'wagmi/actions'
import { wethContract } from '../lib/wethContract'
import { useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import { getCurrentStepDescription } from '../lib/getCurrentStepDescription'

const relayClient = createClient({
  baseApiUrl: TESTNET_RELAY_API,
  source: 'YOUR.SOURCE',
  chains: [
    convertViemChainToRelayChain(baseSepolia),
    convertViemChainToRelayChain(sepolia),
  ],
  pollingInterval: 1000,
})

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
})

// Scenario: You want to self-execute a transaction on a chain where you have no ETH
// Solution: Just-in-time bridge the gas you need to execute the transaction

const Home: NextPage = () => {
  const { address, chain: activeChain } = useAccount()
  const { data: wallet } = useWalletClient()
  const wagmiConfig = useConfig()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<string | undefined>()

  const { data: baseSepoliaBalance, queryKey: baseSepoliaBalanceQueryKey } =
    useBalance({
      address,
      chainId: baseSepolia.id,
    })

  const { data: sepoliaBalance, queryKey: sepoliaBalanceQueryKey } = useBalance(
    {
      address,
      chainId: sepolia.id,
    }
  )

  const { data: sepoliaWethBalance, queryKey: sepoliaWethBalanceQueryKey } =
    useReadContract({
      ...wethContract,
      functionName: 'balanceOf',
      chainId: sepolia.id,
      args: [address as Address],
      query: {
        enabled: address !== undefined,
      },
    })

  useWatchBlocks({
    onBlock() {
      queryClient.invalidateQueries({ queryKey: baseSepoliaBalanceQueryKey })
      queryClient.invalidateQueries({ queryKey: sepoliaBalanceQueryKey })
      queryClient.invalidateQueries({ queryKey: sepoliaWethBalanceQueryKey })
    },
  })

  // Note: This is a simple example with the purpose of demonstrating generally how you would go about implementing just-in-time bridging.
  // There are definitely some improvements and other things to consider when adding this
  const unwrapSepoliaWeth = useCallback(async () => {
    if (!wallet || !address) {
      console.error('Missing wallet')
      return
    }
    try {
      // Make sure user is on the Origin Chain (Base Sepolia)
      if (activeChain?.id !== baseSepolia.id) {
        await switchChain(wagmiConfig, {
          chainId: baseSepolia.id,
        })
      }

      setStep('Estimating gas needed for transaction on Destination Chain')

      const wethBalance = await readContract(wagmiConfig, {
        ...wethContract,
        account: address,
        functionName: 'balanceOf',
        args: [address],
        chainId: sepolia.id,
      })

      const estimatedGas = await publicClient.estimateContractGas({
        ...wethContract,
        functionName: 'withdraw',
        args: [wethBalance],
        account: address,
      })

      const gasPrice = await publicClient.getGasPrice()

      const totalGasEstimation = estimatedGas * gasPrice
      const totalGasEstimationWithBuffer =
        totalGasEstimation + (totalGasEstimation * BigInt(5)) / BigInt(100) // + 5% buffer to handle gas fluctuation

      // Bridge over gas money to the Destination Chain
      await relayClient.actions.bridge({
        chainId: baseSepolia.id,
        toChainId: sepolia.id,
        wallet,
        value: totalGasEstimationWithBuffer.toString(),
        onProgress(steps) {
          setStep(getCurrentStepDescription(steps))
        },
      })

      // Switch chains to Destination Chain (Sepolia)
      await switchChain(wagmiConfig, {
        chainId: sepolia.id,
      })

      // Perform transaction on Destination Chain - unwrap weth
      const { request } = await publicClient.simulateContract({
        ...wethContract,
        account: address,
        functionName: 'withdraw',
        args: [wethBalance],
        chain: sepolia,
        gas: estimatedGas,
      })

      const hash = await wallet.writeContract(request)

      setStep('Waiting for transaction receipt')

      await publicClient.waitForTransactionReceipt({
        hash,
      })

      setStep('Calculating fees for bridge back to Base Sepolia')

      const destinationEthBalance = await getBalance(wagmiConfig, {
        address: address,
        chainId: sepolia.id,
      })

      const { fees } = (await relayClient.actions.bridge({
        chainId: sepolia.id,
        toChainId: baseSepolia.id,
        wallet,
        value: destinationEthBalance.value.toString(),
        precheck: true, // when enabled, skips executing the steps
      })) as Execute

      const bufferedGasFee = BigInt(fees?.gas ?? 0) + 400000000000000n // add buffer - gas estimation is off on testnets

      const amountToBridgeBack =
        destinationEthBalance.value -
        bufferedGasFee -
        BigInt(fees?.relayer ?? 0)

      if (amountToBridgeBack > 0n) {
        await relayClient.actions.bridge({
          chainId: sepolia.id,
          toChainId: baseSepolia.id,
          wallet,
          value: amountToBridgeBack.toString(),
          onProgress(steps) {
            setStep(getCurrentStepDescription(steps))
          },
        })

        setStep('Done')
      } else {
        setStep('Not enough ETH to bridge back to Base Sepolia')
      }
    } catch (e) {
      throw e
    }
  }, [wallet, address, wagmiConfig, activeChain])

  return (
    <main className="flex flex-col items-center gap-4 py-[100px]">
      <ConnectButton />
      <div className="flex  gap-x-20">
        <div className="flex flex-col">
          <Image
            src={
              'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOCIgaGVpZ2h0PSIyOCI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48cGF0aCBmaWxsPSIjMDA1MkZGIiBmaWxsLXJ1bGU9Im5vbnplcm8iIGQ9Ik0xNCAyOGExNCAxNCAwIDEgMCAwLTI4IDE0IDE0IDAgMCAwIDAgMjhaIi8+PHBhdGggZmlsbD0iI0ZGRiIgZD0iTTEzLjk2NyAyMy44NmM1LjQ0NSAwIDkuODYtNC40MTUgOS44Ni05Ljg2IDAtNS40NDUtNC40MTUtOS44Ni05Ljg2LTkuODYtNS4xNjYgMC05LjQwMyAzLjk3NC05LjgyNSA5LjAzaDE0LjYzdjEuNjQySDQuMTQyYy40MTMgNS4wNjUgNC42NTQgOS4wNDcgOS44MjYgOS4wNDdaIi8+PC9nPjwvc3ZnPg'
            }
            alt="Base Sepolia"
            width={30}
            height={30}
          />
          <p className="font-bold underline">Base Sepolia</p>

          <p>ETH Balance: {formatUnits(baseSepoliaBalance?.value || 0n, 18)}</p>
          {activeChain?.id === baseSepolia.id ? (
            <p className="text-green-500">Connected</p>
          ) : null}
        </div>
        <div className="flex flex-col">
          <Image
            src={
              'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOCIgaGVpZ2h0PSIyOCIgZmlsbD0ibm9uZSI+PHBhdGggZmlsbD0iIzI1MjkyRSIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMTQgMjhhMTQgMTQgMCAxIDAgMC0yOCAxNCAxNCAwIDAgMCAwIDI4WiIgY2xpcC1ydWxlPSJldmVub2RkIi8+PHBhdGggZmlsbD0idXJsKCNhKSIgZmlsbC1vcGFjaXR5PSIuMyIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMTQgMjhhMTQgMTQgMCAxIDAgMC0yOCAxNCAxNCAwIDAgMCAwIDI4WiIgY2xpcC1ydWxlPSJldmVub2RkIi8+PHBhdGggZmlsbD0idXJsKCNiKSIgZD0iTTguMTkgMTQuNzcgMTQgMTguMjFsNS44LTMuNDQtNS44IDguMTktNS44MS04LjE5WiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Im0xNCAxNi45My01LjgxLTMuNDRMMTQgNC4zNGw1LjgxIDkuMTVMMTQgMTYuOTNaIi8+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJhIiB4MT0iMCIgeDI9IjE0IiB5MT0iMCIgeTI9IjI4IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHN0b3Agc3RvcC1jb2xvcj0iI2ZmZiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2ZmZiIgc3RvcC1vcGFjaXR5PSIwIi8+PC9saW5lYXJHcmFkaWVudD48bGluZWFyR3JhZGllbnQgaWQ9ImIiIHgxPSIxNCIgeDI9IjE0IiB5MT0iMTQuNzciIHkyPSIyMi45NiIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIHN0b3AtY29sb3I9IiNmZmYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmZmYiIHN0b3Atb3BhY2l0eT0iLjkiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48L3N2Zz4K'
            }
            alt="Sepolia"
            width={30}
            height={30}
          />
          <p className="font-bold underline">Sepolia</p>

          <p>ETH Balance: {formatUnits(sepoliaBalance?.value || 0n, 18)}</p>
          <p>WETH Balance: {formatUnits(sepoliaWethBalance || 0n, 18)}</p>
          {activeChain?.id === sepolia.id ? (
            <p className="text-green-500">Connected</p>
          ) : null}
        </div>
      </div>
      <p>{step}</p>
      <button
        onClick={unwrapSepoliaWeth}
        disabled={!address}
        className="bg-blue-500 py-2 px-4 rounded-md text-white"
      >
        Unwrap Sepolia WETH
      </button>
    </main>
  )
}

export default Home
