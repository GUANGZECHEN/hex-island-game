export function reconnectDelay(attempt:number):number {
  if(attempt<=10)return Math.min(500 * 2 ** Math.max(0,attempt-1),8000);
  if(attempt<=30)return 30000;
  return 60000;
}
