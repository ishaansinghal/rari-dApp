import React, { ReactNode } from "react";
import { Pool } from "../utils/poolUtils";

export const PoolTypeContext = React.createContext<Pool | undefined>(undefined);

export const PoolTypeProvider = ({
  pool,
  children,
}: {
  pool: Pool;
  children: ReactNode;
}) => {
  return (
    <PoolTypeContext.Provider value={pool}>{children}</PoolTypeContext.Provider>
  );
};

export const usePoolType = () => {
  const poolType = React.useContext(PoolTypeContext);

  if (poolType === undefined) {
    throw new Error(`usePoolType must be used within a PoolTypeProvider`);
  }

  return poolType;
};
