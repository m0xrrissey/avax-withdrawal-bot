// WithdrawQueue contract ABI - only the functions we need
export const WITHDRAW_QUEUE_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "offset",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      }
    ],
    "name": "getRequestsByOwner",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      }
    ],
    "name": "canClaimRequest",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      }
    ],
    "name": "getRequestInfo",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "requester",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "shares",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "expectedAssets",
            "type": "uint256"
          },
          {
            "internalType": "uint48",
            "name": "requestTime",
            "type": "uint48"
          },
          {
            "internalType": "uint48",
            "name": "claimableTime",
            "type": "uint48"
          },
          {
            "internalType": "uint48",
            "name": "expirationTime",
            "type": "uint48"
          },
          {
            "internalType": "uint256",
            "name": "allocatedFunds",
            "type": "uint256"
          }
        ],
        "internalType": "struct WithdrawQueue.UnstakeRequest",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];
