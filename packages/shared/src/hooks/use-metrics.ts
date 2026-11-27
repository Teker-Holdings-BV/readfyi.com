import useSWR from "swr";
import { MetricsResponse } from "../types";
import { fetcher } from "../lib/fetcher";

const useMetrics = () => {
  const { data, error } = useSWR<MetricsResponse>("/metrics", fetcher, {
    revalidateOnFocus: false,
  });

  const isFetching = !data && !error;

  return { metrics: data, isFetching, error };
};

export default useMetrics;
