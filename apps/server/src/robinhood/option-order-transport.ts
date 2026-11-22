import { type LongOptionTicket } from "@rh/shared";
import { BrokerMappingError } from "./mapping.ts";
import { optionPlacementAcknowledgment, optionPlacementRequest } from "./option-order-mapping.ts";
import { optionPreviewTools, reviewLongOption } from "./option-preflight.ts";

type Session = () => { date: string; isOpen: boolean };
type Operation = "place_option_order" | (typeof optionPreviewTools)[number];
type Request = (operation: Operation, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Produces the single-use placement handle held privately by the order gate.
 * No agent-facing extension calls this function. `call` must be the protected
 * broker transport with discovered-schema validation and the hard live lock.
 */
export async function prepareOptionPlacement(ticket: LongOptionTicket, call: Request, session: Session, expectedAccount?: string) {
  const tradingDate = session().date;
  const { request, preview } = await reviewLongOption(ticket, call, session, undefined, expectedAccount);
  const noAlerts = preview.preTradeAlertCount === 0;
  const approvalRequired = preview.robinhoodApprovalRequired;
  let sent = false;
  return {
    noAlerts,
    approvalRequired,
    async place(localOrderId: string) {
      const market = session();
      if (!market.isOpen || market.date !== tradingDate || !noAlerts || approvalRequired || sent) {
        throw new BrokerMappingError("The reviewed option is not eligible for placement.");
      }
      const args = optionPlacementRequest(request, localOrderId);
      sent = true;
      return optionPlacementAcknowledgment(await call("place_option_order", args));
    },
  };
}
