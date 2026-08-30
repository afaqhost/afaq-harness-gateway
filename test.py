curl https://ahg.nasseralammari.com/v1/chat/completions \
  -H "Authorization: Bearer afaq_02EuWJX6aG8kwrgjq1hM67Qo7c8pTMCbcLPxQ2GS0E4" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opencode//opencode/big-pickle",
    "messages": [
      {
        "role": "user",
        "content": "اكتب لي جملة ترحيبية قصيرة"
      }
    ]
  }'