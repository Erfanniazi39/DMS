"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

// The company's own details (GET /company, any logged-in user). Shared by the
// settings page and every print page; fetched once per page load.
export type CompanyProfile = {
  legalName: string;
  brandName: string | null;
  companyType: string | null;
  nationalId: string | null;
  economicCode: string | null;
  registrationNumber: string | null;
  province: string | null;
  city: string | null;
  postalCode: string | null;
  address: string | null;
  phone1: string | null;
  phone2: string | null;
  fax: string | null;
  email: string | null;
  website: string | null;
  documentFooter: string | null;
  hasLogo: boolean;
  logoUrl: string | null;
};

let cached: Promise<CompanyProfile> | null = null;

export function loadCompanyProfile(force = false): Promise<CompanyProfile> {
  if (!cached || force) {
    cached = apiFetch<CompanyProfile>("/company");
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

/** null while loading or if it could not be loaded. */
export function useCompanyProfile(): CompanyProfile | null {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  useEffect(() => {
    let ignore = false;
    loadCompanyProfile()
      .then((data) => {
        if (!ignore) setProfile(data);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);
  return profile;
}
