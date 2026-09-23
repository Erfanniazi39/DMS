-- DropForeignKey
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_buyer_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_requester_department_id_fkey";

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_requester_department_id_fkey" FOREIGN KEY ("requester_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_buyer_employee_id_fkey" FOREIGN KEY ("buyer_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
